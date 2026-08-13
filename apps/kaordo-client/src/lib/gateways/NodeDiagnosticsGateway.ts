import type { NodoAccess, NodoQuickTest } from '../domain/nodo';

const TEST_TIMEOUT_MS = 8_000;

export async function runNodeQuickTest(access: NodoAccess): Promise<NodoQuickTest> {
  let lastError: unknown = null;
  for (const candidate of access.candidates.filter(({ kind }) => kind === 'lan')) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const host = candidate.address.includes(':') ? `[${candidate.address}]` : candidate.address;
      const response = await fetch(`http://${host}:${candidate.port}/v1/diagnostics/quick-test`, {
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
    } finally {
      clearTimeout(timer);
    }
  }
  const detail = lastError instanceof Error && lastError.name !== 'AbortError'
    ? ` ${lastError.message}`
    : '';
  throw new Error(`The Nodo quick test could not be completed.${detail}`);
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
