import type {
  NodoAccess,
  NodoQuickTest,
  NodoTelemetryField,
  NodoTelemetryMetrics,
  NodoTelemetryProgress,
} from '../domain/nodo';
import { nodoOrigin, orderedNodoCandidates, type NodoRouteCandidate } from './NodoRoute';

const TEST_DEADLINE_MS = 4_900;
const ROUTE_PROBE_MS = 850;
const FALLBACK_ROUTE_PROBE_MS = 650;

type TestGroup = {
  fields: readonly NodoTelemetryField[];
  path: string;
  read: (value: Record<string, unknown>) => Partial<NodoTelemetryMetrics>;
};

const TEST_GROUPS: readonly TestGroup[] = [
  {
    fields: ['battery'],
    path: '/v1/diagnostics/battery',
    read: (value) => ({
      batteryPercent: nullableNumber(value.batteryPercent, 0, 100),
      charging: nullableBoolean(value.charging),
    }),
  },
  {
    fields: ['memory'],
    path: '/v1/diagnostics/memory',
    read: (value) => ({
      memoryAvailableBytes: requiredNumber(value.memoryAvailableBytes),
      memoryTotalBytes: requiredNumber(value.memoryTotalBytes),
      storageAvailableBytes: requiredNumber(value.storageAvailableBytes),
    }),
  },
  {
    fields: ['connection', 'download', 'upload'],
    path: '/v1/diagnostics/network',
    read: (value) => ({
      networkDownBps: nullableNumber(value.networkDownBps),
      networkMetered: nullableBoolean(value.networkMetered),
      networkType: networkType(value.networkType),
      networkUpBps: nullableNumber(value.networkUpBps),
    }),
  },
  {
    fields: ['latency'],
    path: '/v1/diagnostics/latency',
    read: (value) => ({ coordinatorLatencyMs: requiredNumber(value.coordinatorLatencyMs) }),
  },
  {
    fields: ['read', 'write'],
    path: '/v1/diagnostics/disk',
    read: (value) => ({
      diskReadBps: requiredNumber(value.diskReadBps, 1),
      diskWriteBps: requiredNumber(value.diskWriteBps, 1),
    }),
  },
] as const;

/** Runs fresh host diagnostics concurrently under one hard five-second deadline. */
export async function runNodeQuickTest(
  access: NodoAccess,
  onUpdate?: NodoTelemetryProgress,
): Promise<NodoQuickTest> {
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), TEST_DEADLINE_MS);
  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  try {
    const candidate = await selectResponsiveCandidate(access, deadline.signal, runId);
    const origin = nodoOrigin(candidate);
    const completedAt: number[] = [];
    const metrics: Partial<NodoTelemetryMetrics> = {};
    const failures: string[] = [];

    await Promise.all(TEST_GROUPS.map(async (group) => {
      try {
        const response = await fetch(`${origin}${group.path}?fresh=${encodeURIComponent(runId)}`, {
          cache: 'no-store',
          headers: {
            authorization: `Bearer ${access.ticket}`,
            'cache-control': 'no-cache, no-store',
          },
          method: 'POST',
          signal: deadline.signal,
        });
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorMessage(value, response.status));
        const record = objectValue(value);
        const timestamp = requiredNumber(record.completedAt, 1);
        const update = group.read(record);
        completedAt.push(timestamp);
        Object.assign(metrics, update);
        onUpdate?.({ fields: group.fields, metrics: update });
      } catch (error) {
        const message = readableError(error);
        failures.push(`${group.fields.join('/')}: ${message}`);
        onUpdate?.({ error: message, fields: group.fields });
      }
    }));

    if (failures.length) {
      throw new Error(`Some Nodo diagnostics could not be refreshed. ${failures.join(' · ')}`);
    }
    if (!isCompleteMetrics(metrics)) throw new Error('Nodo returned an incomplete test result.');
    return { ...metrics, completedAt: Math.max(...completedAt) };
  } finally {
    clearTimeout(deadlineTimer);
  }
}

async function selectResponsiveCandidate(
  access: NodoAccess,
  deadline: AbortSignal,
  runId: string,
): Promise<NodoRouteCandidate> {
  const candidates = orderedNodoCandidates(access);
  if (!candidates.length) throw new Error('The Nodo has no reachable route.');
  // Probe one route of each kind in priority order. Starting every LAN,
  // public, and relay candidate in parallel used to create duplicate Worker
  // requests for the same health check. One bounded attempt per route kind
  // retains fallback reliability without multiplying free-tier traffic.
  const probes = candidates.filter((candidate, index) =>
    candidates.findIndex(({ kind }) => kind === candidate.kind) === index,
  );
  for (const [index, candidate] of probes.entries()) {
    if (deadline.aborted) break;
    const probe = new AbortController();
    const abortProbe = () => probe.abort();
    deadline.addEventListener('abort', abortProbe, { once: true });
    const timer = setTimeout(() => probe.abort(), index === 0 ? ROUTE_PROBE_MS : FALLBACK_ROUTE_PROBE_MS);
    try {
      const response = await fetch(`${nodoOrigin(candidate)}/v1/status?fresh=${encodeURIComponent(runId)}`, {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${access.ticket}`,
          'cache-control': 'no-cache, no-store',
        },
        signal: probe.signal,
      });
      if (!response.ok) throw new Error(`${candidate.kind} route returned ${response.status}.`);
      await response.body?.cancel().catch(() => undefined);
      return candidate;
    } catch {
      // Try the next route kind while the shared five-second deadline allows.
    } finally {
      clearTimeout(timer);
      deadline.removeEventListener('abort', abortProbe);
      probe.abort();
    }
  }
  throw new Error('The Nodo did not respond before the telemetry deadline.');
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('Nodo returned invalid telemetry.');
  return value as Record<string, unknown>;
}

function requiredNumber(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error('Nodo returned invalid telemetry.');
  }
  return value;
}

function nullableNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null) return null;
  const number = requiredNumber(value, minimum);
  if (number > maximum) throw new Error('Nodo returned invalid telemetry.');
  return number;
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null) return null;
  if (typeof value !== 'boolean') throw new Error('Nodo returned invalid telemetry.');
  return value;
}

function networkType(value: unknown): NodoTelemetryMetrics['networkType'] {
  if (value === 'cellular' || value === 'ethernet' || value === 'offline' ||
    value === 'other' || value === 'wifi') return value;
  throw new Error('Nodo returned invalid telemetry.');
}

function isCompleteMetrics(value: Partial<NodoTelemetryMetrics>): value is NodoTelemetryMetrics {
  return 'batteryPercent' in value && 'charging' in value &&
    'coordinatorLatencyMs' in value && 'diskReadBps' in value && 'diskWriteBps' in value &&
    'memoryAvailableBytes' in value && 'memoryTotalBytes' in value &&
    'networkDownBps' in value && 'networkMetered' in value && 'networkType' in value &&
    'networkUpBps' in value && 'storageAvailableBytes' in value;
}

function errorMessage(value: unknown, status: number): string {
  return typeof value === 'object' && value !== null && 'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : `Nodo request failed (${status}).`;
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Timed out after five seconds.';
  return error instanceof Error && error.message.trim() ? error.message.trim() : 'Network error.';
}
