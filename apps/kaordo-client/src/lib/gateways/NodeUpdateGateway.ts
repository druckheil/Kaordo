import type { NodoAccess, NodoUpdateResult } from '../domain/nodo';
import { nodoOrigin, orderedNodoCandidates, type NodoRouteCandidate } from './NodoRoute';

const UPDATE_TOTAL_TIMEOUT_MS = 8_500;
const UPDATE_REQUEST_TIMEOUT_MS = 4_000;
const UPDATE_STATUS_TIMEOUT_MS = 1_000;
// The child update process downloads and installs independently. Only sample
// its status briefly; never keep the UI waiting for a potentially large
// binary or a service restart.
const UPDATE_POLL_DELAYS_MS = [250, 750, 1_250] as const;

/**
 * Requests a Linux Nodo self-update over the same direct/relay capability
 * route used by storage. The update process restarts the host itself, so a
 * short, bounded status poll gives the desktop a useful final result without
 * keeping a Worker request open while a binary is downloaded.
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
      if (parsed.status !== 'started' || !parsed.jobId) return parsed;
      return await waitForUpdate(access, candidate, parsed, deadline);
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
  deadline: number,
): Promise<NodoUpdateResult> {
  let lastError: unknown = null;
  let preferredCandidate = preferred;
  for (const delayMs of UPDATE_POLL_DELAYS_MS) {
    const delayBudget = deadline - Date.now();
    if (delayBudget <= 0) break;
    await delay(Math.min(delayMs, delayBudget));
    const candidates = orderedNodoCandidates(access).sort((left, right) =>
      Number(right === preferredCandidate) - Number(left === preferredCandidate));
    for (const candidate of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const result = await requestCandidate(
          access,
          candidate,
          `/v1/update/status?jobId=${encodeURIComponent(started.jobId!)}`,
          'GET',
          Math.min(UPDATE_STATUS_TIMEOUT_MS, remaining),
        );
        const parsed = parseUpdateResult(result);
        if (!parsed) throw new Error('Nodo returned an invalid update status.');
        if (parsed.status !== 'started') return parsed;
        preferredCandidate = candidate;
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
      ? `Update started in the background. ${lastError.message}`
      : 'Update started in the background. The new version will appear after the Nodo reconnects.',
  };
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Resolves or rejects within a strict UI budget without leaving a spinner behind. */
export function withTimeout<T>(promise: Promise<T>, timeoutMilliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMilliseconds);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
