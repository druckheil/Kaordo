import type { NodoAccess, NodoQuickTest } from '../domain/nodo';
import { nodoOrigin, orderedNodoCandidates } from './NodoRoute';

const TEST_TIMEOUT_MS = 8_000;

export async function runNodeQuickTest(access: NodoAccess): Promise<NodoQuickTest> {
  let lastError: unknown = null;
  const failures: string[] = [];
  // A Linux Nodo is commonly hosted on a VPS and therefore has no LAN
  // candidate. Prefer the low-latency LAN route when it exists, but always
  // fall back to the observed public address instead of silently skipping the
  // diagnostic altogether.
  for (const candidate of orderedNodoCandidates(access)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${nodoOrigin(candidate)}/v1/diagnostics/quick-test`, {
        cache: 'no-store',
        headers: { authorization: `Bearer ${access.ticket}` },
        method: 'POST',
        signal: controller.signal,
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(value, response.status));
      if (!isQuickTest(value)) throw new Error('Nodo returned an invalid test result.');
      return value;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : error instanceof Error ? error.name : 'Network error';
      failures.push(`${candidate.kind}: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const detail = lastError instanceof Error && lastError.name !== 'AbortError'
    ? ` ${lastError.message}`
    : '';
  const attempts = failures.length ? ` Attempts: ${failures.join(' · ')}` : '';
  throw new Error(`The Nodo quick test could not be completed.${detail}${attempts}`);
}

function isQuickTest(value: unknown): value is NodoQuickTest {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return Number.isSafeInteger(result.completedAt) &&
    typeof result.diskReadBps === 'number' && result.diskReadBps > 0 &&
    typeof result.diskWriteBps === 'number' && result.diskWriteBps > 0;
}

function errorMessage(value: unknown, status: number): string {
  return typeof value === 'object' && value !== null && 'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : `Nodo request failed (${status}).`;
}
