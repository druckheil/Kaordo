import type { NodoAccess, NodoUpdateResult } from '../domain/nodo';
import { nodoOrigin, orderedNodoCandidates, type NodoRouteCandidate } from './NodoRoute';

const UPDATE_REQUEST_TIMEOUT_MS = 10_000;
const UPDATE_POLL_INTERVAL_MS = 900;
const UPDATE_POLL_ATTEMPTS = 40;

/**
 * Requests a Linux Nodo self-update over the same direct/relay capability
 * route used by storage. The update process restarts the host itself, so a
 * short, bounded status poll gives the desktop a useful final result without
 * keeping a Worker request open while a binary is downloaded.
 */
export async function updateNode(access: NodoAccess): Promise<NodoUpdateResult> {
  let lastError: unknown = null;
  for (const candidate of orderedNodoCandidates(access)) {
    try {
      const result = await requestCandidate(access, candidate, '/v1/update', 'POST');
      const parsed = parseUpdateResult(result);
      if (!parsed) throw new Error('Nodo returned an invalid update result.');
      if (parsed.status !== 'started' || !parsed.jobId) return parsed;
      return await waitForUpdate(access, candidate, parsed);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? new Error(`Nodo update could not be reached. ${lastError.message}`)
    : new Error('Nodo update could not be reached. Keep the Linux host online.');
}

async function waitForUpdate(
  access: NodoAccess,
  preferred: NodoRouteCandidate,
  started: NodoUpdateResult,
): Promise<NodoUpdateResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < UPDATE_POLL_ATTEMPTS; attempt += 1) {
    await delay(UPDATE_POLL_INTERVAL_MS);
    for (const candidate of orderedNodoCandidates(access).sort((left, right) =>
      Number(right === preferred) - Number(left === preferred))) {
      try {
        const result = await requestCandidate(
          access,
          candidate,
          `/v1/update/status?jobId=${encodeURIComponent(started.jobId!)}`,
          'GET',
        );
        const parsed = parseUpdateResult(result);
        if (!parsed) throw new Error('Nodo returned an invalid update status.');
        if (parsed.status !== 'started') return parsed;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
  }
  return {
    ...started,
    message: lastError instanceof Error
      ? `Update is still running. ${lastError.message}`
      : 'Update is still running. The new version will appear after the Nodo reconnects.',
  };
}

async function requestCandidate(
  access: NodoAccess,
  candidate: NodoRouteCandidate,
  path: string,
  method: 'GET' | 'POST',
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_REQUEST_TIMEOUT_MS);
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
  if (typeof record.currentVersion !== 'string' ||
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
