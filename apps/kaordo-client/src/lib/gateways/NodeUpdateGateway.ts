import type { NodoAccess, NodoUpdateResult } from '../domain/nodo';
import { nodoOrigin, orderedNodoCandidates, type NodoRouteCandidate } from './NodoRoute';

const UPDATE_TOTAL_TIMEOUT_MS = 6_000;
const UPDATE_REQUEST_TIMEOUT_MS = 4_500;

/**
 * Requests a Linux Nodo self-update over the same direct/relay capability
 * route used by storage. The host acknowledges the command immediately and
 * performs the verified replacement/restart in its own helper process. The
 * client therefore never waits for a binary download or a service restart.
 */
export async function updateNode(access: NodoAccess): Promise<NodoUpdateResult> {
  const deadline = Date.now() + UPDATE_TOTAL_TIMEOUT_MS;
  let lastError: unknown = null;
  for (const candidate of orderedNodoCandidates(access)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const result = await requestCandidate(
        access,
        candidate,
        '/v1/update',
        'POST',
        Math.min(UPDATE_REQUEST_TIMEOUT_MS, remaining),
      );
      const parsed = parseUpdateResult(result);
      if (!parsed) throw new Error('Nodo returned an invalid update result.');
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? new Error(`Nodo update could not be reached. ${lastError.message}`)
    : new Error('Nodo update could not be reached. Keep the Linux host online.');
}

async function requestCandidate(
  access: NodoAccess,
  candidate: NodoRouteCandidate,
  path: string,
  method: 'GET' | 'POST',
  timeoutMs = UPDATE_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${nodoOrigin(candidate)}${path}`, {
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${access.ticket}`,
        'cache-control': 'no-cache, no-store',
      },
      method,
      signal: controller.signal,
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(value, response.status));
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function parseUpdateResult(value: unknown): NodoUpdateResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.currentVersion !== 'string' || !record.currentVersion.trim() ||
    (record.status !== 'failed' && record.status !== 'installed' &&
      record.status !== 'started' && record.status !== 'up-to-date')) return null;
  const result: NodoUpdateResult = {
    currentVersion: record.currentVersion,
    status: record.status,
  };
  if (typeof record.jobId === 'string') result.jobId = record.jobId;
  if (typeof record.targetVersion === 'string') result.targetVersion = record.targetVersion;
  if (typeof record.message === 'string') result.message = record.message;
  return result;
}

function errorMessage(value: unknown, status: number): string {
  return typeof value === 'object' && value !== null && 'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : `Nodo request failed (${status}).`;
}

/** Resolves or rejects within a strict UI budget without leaving a spinner behind. */
export function withTimeout<T>(promise: Promise<T>, timeoutMilliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMilliseconds);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
