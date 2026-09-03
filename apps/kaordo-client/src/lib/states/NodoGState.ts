import {
  NODO_TELEMETRY_FIELDS,
  type NodoNode,
  type NodoNodeUsage,
  type NodoPolicy,
  type NodoTelemetryField,
  type NodoTelemetryUpdate,
} from '../domain/nodo';
import type { NodoGateway } from '../gateways/NodoGateway';
import { GState } from '../state/GState';
import { NodoRegistry } from '../services/NodoRegistry';
import { mapConcurrent } from '../services/async';

export type NodoOperation = { nodeId: string; type: 'clear' | 'clear-private' | 'delete' | 'policy' | 'rename' | 'spaces' | 'test' };

export type NodoTelemetryState = 'error' | 'loading' | 'ready';

export type NodoTelemetryTest = {
  fields: Record<NodoTelemetryField, NodoTelemetryState>;
  nodeId: string;
};

const NODE_LIST_CACHE_MS = 15_000;
const NODE_USAGE_CACHE_MS = 15_000;
const NODE_REFRESH_DEADLINE_MS = 9_000;
const NODE_LIST_DEADLINE_MS = 5_000;
const NODE_USAGE_DEADLINE_MS = 3_500;
const NODE_USAGE_CONCURRENCY = 4;

export type NodoSnapshot = {
  error: string | null;
  nodes: NodoNode[];
  operation: NodoOperation | null;
  phase: 'idle' | 'loading' | 'ready';
  telemetryTest?: NodoTelemetryTest | null;
};

export class NodoGState extends GState<NodoSnapshot> {
  readonly #gateway: NodoGateway;
  readonly #registry: NodoRegistry;
  #refreshTimer: ReturnType<typeof setInterval> | null = null;
  #refreshInFlight: Promise<void> | null = null;
  #lifecycleId = 0;
  #requestId = 0;
  #lastRefreshAt = 0;
  #lastUsageRefreshAt = new Map<string, number>();
  #usageInFlight = new Map<string, Promise<NodoNodeUsage>>();
  #unsubscribeRegistry: (() => void) | null = null;
  readonly #visibilityChanged = () => {
    if (document.visibilityState === 'visible') void this.refresh(true);
  };

  constructor(gateway: NodoGateway, registry = new NodoRegistry()) {
    super({ error: null, nodes: [...registry.nodes], operation: null, phase: 'idle', telemetryTest: null });
    this.#gateway = gateway;
    this.#registry = registry;
  }

  override enter(): void {
    this.#unsubscribeRegistry = this.#registry.subscribe((nodes) => {
      this.publish({ ...this.snapshot, nodes: [...nodes] });
    });
    // Section switches reuse a very recent fleet snapshot. The explicit
    // Refresh button still passes the default force=true below.
    void this.refresh(false, false);
    this.#refreshTimer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void this.refresh(true);
      }
    }, 60_000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#visibilityChanged);
    }
  }

  override exit(): void {
    this.#requestId += 1;
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    this.#refreshTimer = null;
    this.#refreshInFlight = null;
    this.#usageInFlight.clear();
    this.#unsubscribeRegistry?.();
    this.#unsubscribeRegistry = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#visibilityChanged);
    }
  }

  reset(): void {
    this.#requestId += 1;
    this.#lifecycleId += 1;
    this.#lastRefreshAt = 0;
    this.#lastUsageRefreshAt.clear();
    this.#usageInFlight.clear();
    this.#registry.reset();
    this.publish({ error: null, nodes: [], operation: null, phase: 'idle', telemetryTest: null });
  }

  refresh(background = false, force = true): Promise<void> {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    if (
      !background && !force && this.snapshot.phase === 'ready' &&
      Date.now() - this.#lastRefreshAt < NODE_LIST_CACHE_MS
    ) return Promise.resolve();
    const requestId = ++this.#requestId;
    const refresh = this.refreshInternal(requestId, background, force);
    const shared = refresh.finally(() => {
      if (this.#refreshInFlight === shared) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = shared;
    return shared;
  }

  private async refreshInternal(requestId: number, background: boolean, force: boolean): Promise<void> {
    if (!background) this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    try {
      const refreshDeadline = Date.now() + NODE_REFRESH_DEADLINE_MS;
      const nodes = await bounded(
        this.#gateway.listNodes(),
        Math.min(NODE_LIST_DEADLINE_MS, remaining(refreshDeadline)),
        'Nodo list refresh timed out.',
      );
      if (requestId !== this.#requestId) return;
      this.#lastRefreshAt = Date.now();
      // D1 heartbeats are intentionally sparse. A foreground refresh also
      // asks each reachable host for its live usage so uploads made moments
      // ago are reflected immediately without adding polling traffic.
      const refreshed = background
        ? nodes
        : await mapConcurrent(nodes, NODE_USAGE_CONCURRENCY, async (node) => {
          const refreshedAt = this.#lastUsageRefreshAt.get(node.id) ?? 0;
          if (!force && Date.now() - refreshedAt < NODE_USAGE_CACHE_MS) return node;
          try {
            const usage = await this.loadUsage(
              node.id,
              Math.min(NODE_USAGE_DEADLINE_MS, remaining(refreshDeadline)),
            );
            this.#lastUsageRefreshAt.set(node.id, Date.now());
            return { ...node, spaces: usage.spaces, usedBytes: usage.usedBytes };
          } catch {
            return node;
          }
          });
      if (requestId !== this.#requestId) return;
      this.#registry.replace(refreshed);
      this.publish({ ...this.snapshot, error: null, nodes: [...this.#registry.nodes], phase: 'ready' });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), phase: 'ready' });
    }
  }

  /** Reconciles one host after a direct Fluo/Ligo write without polling the fleet. */
  async refreshNodeUsage(nodeId: string): Promise<void> {
    const lifecycleId = this.#lifecycleId;
    try {
      const usage = await this.loadUsage(nodeId, NODE_USAGE_DEADLINE_MS);
      if (lifecycleId !== this.#lifecycleId) return;
      this.#lastUsageRefreshAt.set(nodeId, Date.now());
      this.#registry.update(nodeId, (node) => ({ ...node, spaces: usage.spaces, usedBytes: usage.usedBytes }));
    } catch {
      // The next foreground refresh will reconcile an offline or unreachable host.
    }
  }

  /**
   * Share a usage read when a targeted reconciliation overlaps the fleet
   * refresh. This keeps a direct write from producing a duplicate Nodo/Worker
   * request while retaining the existing timeout for each caller.
   */
  private loadUsage(nodeId: string, timeoutMilliseconds: number): Promise<NodoNodeUsage> {
    const existing = this.#usageInFlight.get(nodeId);
    if (existing) {
      // A fleet refresh may join a targeted read with less time left on its
      // global deadline. Keep that caller's timeout independent of the
      // request that happened to create the shared promise.
      return bounded(existing, timeoutMilliseconds, 'Nodo usage refresh timed out.');
    }

    const request = this.#gateway.refreshUsage(nodeId).finally(() => {
      if (this.#usageInFlight.get(nodeId) === request) this.#usageInFlight.delete(nodeId);
    });
    this.#usageInFlight.set(nodeId, request);
    // The caller-specific bounded wrapper below handles the rejection. Keep
    // the shared request itself observed as well so a timed-out caller cannot
    // leave an unhandled rejection while the underlying Nodo response settles.
    void request.catch(() => undefined);
    return bounded(request, timeoutMilliseconds, 'Nodo usage refresh timed out.');
  }

  async deleteNode(nodeId: string): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'delete' } });
    try {
      await this.#gateway.deleteNode(nodeId);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.#registry.remove(nodeId);
      this.publish({
        ...this.snapshot,
        nodes: this.snapshot.nodes.filter((node) => node.id !== nodeId),
        operation: null,
      });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  async renameNode(nodeId: string, name: string): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const normalizedName = name.trim();
    if (!normalizedName) {
      this.publish({ ...this.snapshot, error: 'Nodo name cannot be empty.' });
      return false;
    }
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'rename' } });
    try {
      const deviceName = await this.#gateway.renameNode(nodeId, normalizedName);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.#registry.update(nodeId, (node) => ({ ...node, deviceName }));
      this.publish({ ...this.#registrySnapshot(), error: null, operation: null });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  async clearStorage(nodeId: string): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'clear' } });
    try {
      await this.#gateway.clearStorage(nodeId);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.#registry.update(nodeId, (node) => ({
        ...node,
        spaces: {
          private: { ...node.spaces.private, usedBytes: 0 },
          public: { ...node.spaces.public, usedBytes: 0 },
        },
        usedBytes: 0,
      }));
      this.publish({ ...this.snapshot, error: null, operation: null });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  #registrySnapshot(): NodoSnapshot {
    return {
      ...this.snapshot,
      nodes: [...this.#registry.nodes],
    };
  }

  async clearPrivateStorage(nodeId: string): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'clear-private' } });
    try {
      await this.#gateway.clearPrivateStorage(nodeId);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.#registry.update(nodeId, (node) => ({
        ...node,
        spaces: {
          private: { ...node.spaces.private, usedBytes: 0 },
          public: node.spaces.public,
        },
        usedBytes: node.spaces.public.usedBytes,
      }));
      this.publish({ ...this.snapshot, error: null, operation: null });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  async requestQuickTest(nodeId: string): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const lifecycleId = this.#lifecycleId;
    const fields = Object.fromEntries(
      NODO_TELEMETRY_FIELDS.map((field) => [field, 'loading']),
    ) as Record<NodoTelemetryField, NodoTelemetryState>;
    this.publish({
      ...this.snapshot,
      error: null,
      operation: { nodeId, type: 'test' },
      telemetryTest: { fields, nodeId },
    });
    try {
      const result = await this.#gateway.requestQuickTest(nodeId, (update) => {
        if (lifecycleId !== this.#lifecycleId) return;
        this.#applyTelemetryUpdate(nodeId, update);
      });
      if (lifecycleId !== this.#lifecycleId) return true;
      const { completedAt, ...metrics } = result;
      this.#registry.update(nodeId, (node) => ({
        ...node,
        diagnostics: {
          completedAt,
          requestedAt: completedAt,
          running: false,
        },
        metrics: {
          ...node.metrics,
          ...metrics,
        },
      }));
      const telemetryTest = this.snapshot.telemetryTest?.nodeId === nodeId
        ? {
            ...this.snapshot.telemetryTest,
            fields: Object.fromEntries(
              NODO_TELEMETRY_FIELDS.map((field) => [field, 'ready']),
            ) as Record<NodoTelemetryField, NodoTelemetryState>,
          }
        : this.snapshot.telemetryTest;
      this.publish({ ...this.#registrySnapshot(), error: null, operation: null, telemetryTest });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      const telemetryTest = this.snapshot.telemetryTest?.nodeId === nodeId
        ? {
            ...this.snapshot.telemetryTest,
            fields: Object.fromEntries(NODO_TELEMETRY_FIELDS.map((field) => [
              field,
              this.snapshot.telemetryTest?.fields[field] === 'loading'
                ? 'error'
                : this.snapshot.telemetryTest?.fields[field] ?? 'error',
            ])) as Record<NodoTelemetryField, NodoTelemetryState>,
          }
        : this.snapshot.telemetryTest;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null, telemetryTest });
      return false;
    }
  }

  #applyTelemetryUpdate(nodeId: string, update: NodoTelemetryUpdate): void {
    if (update.metrics) {
      this.#registry.update(nodeId, (node) => ({
        ...node,
        metrics: { ...node.metrics, ...update.metrics },
      }));
    }
    const current = this.snapshot.telemetryTest;
    if (!current || current.nodeId !== nodeId) return;
    const fields = { ...current.fields };
    for (const field of update.fields) fields[field] = update.error ? 'error' : 'ready';
    this.publish({
      ...this.#registrySnapshot(),
      telemetryTest: { fields, nodeId },
    });
  }

  async updatePolicy(
    nodeId: string,
    next: Omit<NodoPolicy, 'ownerOnly'>,
  ): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'policy' } });
    try {
      const policy = await this.#gateway.updatePolicy(nodeId, next);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.publish({
        ...this.snapshot,
        nodes: this.snapshot.nodes.map((node) => node.id === nodeId ? { ...node, policy } : node),
        operation: null,
      });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  async updateSpaces(nodeId: string, publicQuotaBytes: number): Promise<boolean> {
    if (this.snapshot.operation) return false;
    const node = this.snapshot.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'spaces' } });
    try {
      const spaces = await this.#gateway.updateSpaces(nodeId, {
        privateQuotaBytes: node.quotaBytes - publicQuotaBytes,
        publicQuotaBytes,
      });
      if (lifecycleId !== this.#lifecycleId) return true;
      this.#registry.update(nodeId, (current) => ({ ...current, spaces }));
      this.publish({ ...this.snapshot, error: null, operation: null });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof error.message === 'string' && error.message.trim()) return error.message;
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Nodo service is unavailable.';
}

function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function bounded<T>(promise: Promise<T>, timeoutMilliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMilliseconds);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
