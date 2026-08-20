import type { NodoNode, NodoPolicy } from '../domain/nodo';
import type { NodoGateway } from '../gateways/NodoGateway';
import { GState } from '../state/GState';
import { NodoRegistry } from '../services/NodoRegistry';

export type NodoOperation = { nodeId: string; type: 'clear' | 'clear-private' | 'delete' | 'policy' | 'rename' | 'spaces' | 'test' };

export type NodoSnapshot = {
  error: string | null;
  nodes: NodoNode[];
  operation: NodoOperation | null;
  phase: 'idle' | 'loading' | 'ready';
};

export class NodoGState extends GState<NodoSnapshot> {
  readonly #gateway: NodoGateway;
  readonly #registry: NodoRegistry;
  #refreshTimer: ReturnType<typeof setInterval> | null = null;
  #testRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  #entered = false;
  #lifecycleId = 0;
  #requestId = 0;
  #unsubscribeRegistry: (() => void) | null = null;
  readonly #visibilityChanged = () => {
    if (document.visibilityState === 'visible') void this.refresh(true);
  };

  constructor(gateway: NodoGateway, registry = new NodoRegistry()) {
    super({ error: null, nodes: [...registry.nodes], operation: null, phase: 'idle' });
    this.#gateway = gateway;
    this.#registry = registry;
  }

  override enter(): void {
    this.#entered = true;
    this.#unsubscribeRegistry = this.#registry.subscribe((nodes) => {
      this.publish({ ...this.snapshot, nodes: [...nodes] });
    });
    void this.refresh();
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
    this.#entered = false;
    this.#requestId += 1;
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    if (this.#testRefreshTimer) clearTimeout(this.#testRefreshTimer);
    this.#refreshTimer = null;
    this.#testRefreshTimer = null;
    this.#unsubscribeRegistry?.();
    this.#unsubscribeRegistry = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#visibilityChanged);
    }
  }

  reset(): void {
    this.#requestId += 1;
    this.#lifecycleId += 1;
    this.#registry.reset();
    this.publish({ error: null, nodes: [], operation: null, phase: 'idle' });
  }

  async refresh(background = false): Promise<void> {
    const requestId = ++this.#requestId;
    if (!background) this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    try {
      const nodes = await this.#gateway.listNodes();
      if (requestId !== this.#requestId) return;
      // D1 heartbeats are intentionally sparse. A foreground refresh also
      // asks each reachable host for its live usage so uploads made moments
      // ago are reflected immediately without adding polling traffic.
      const refreshed = background
        ? nodes
        : await Promise.all(nodes.map(async (node) => {
            try {
              const usage = await this.#gateway.refreshUsage(node.id);
              return { ...node, spaces: usage.spaces, usedBytes: usage.usedBytes };
            } catch {
              return node;
            }
          }));
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
      const usage = await this.#gateway.refreshUsage(nodeId);
      if (lifecycleId !== this.#lifecycleId) return;
      this.#registry.update(nodeId, (node) => ({ ...node, spaces: usage.spaces, usedBytes: usage.usedBytes }));
    } catch {
      // The next foreground refresh will reconcile an offline or unreachable host.
    }
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
    this.publish({ ...this.snapshot, error: null, operation: { nodeId, type: 'test' } });
    try {
      const result = await this.#gateway.requestQuickTest(nodeId);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.publish({
        ...this.snapshot,
        nodes: this.snapshot.nodes.map((node) => node.id === nodeId
          ? {
              ...node,
              diagnostics: {
                completedAt: result.completedAt,
                requestedAt: result.completedAt,
                running: false,
              },
              metrics: {
                ...node.metrics,
                diskReadBps: result.diskReadBps,
                diskWriteBps: result.diskWriteBps,
              },
            }
          : node),
        operation: null,
      });
      if (this.#testRefreshTimer) clearTimeout(this.#testRefreshTimer);
      if (this.#entered) {
        this.#testRefreshTimer = setTimeout(() => {
          this.#testRefreshTimer = null;
          void this.refresh(true);
        }, 1_200);
      }
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
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
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Nodo service is unavailable.';
}
