import type { NodoAccess, NodoStorageClearResult } from '../domain/nodo';

const REQUEST_TIMEOUT_MS = 30_000;

export async function clearNodeStorage(access: NodoAccess): Promise<NodoStorageClearResult> {
  return clearStorageAt(access, '/v1/storage');
}

export async function clearPrivateNodeStorage(access: NodoAccess): Promise<NodoStorageClearResult> {
  return clearStorageAt(access, '/v1/spaces/private/storage');
}

async function clearStorageAt(access: NodoAccess, path: string): Promise<NodoStorageClearResult> {
  let lastError: unknown = null;
  for (const candidate of uniqueLanCandidates(access)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const host = candidate.address.includes(':') ? `[${candidate.address}]` : candidate.address;
      const response = await fetch(`http://${host}:${candidate.port}${path}`, {
        cache: 'no-store',
        headers: { authorization: `Bearer ${access.ticket}` },
        method: 'DELETE',
        signal: controller.signal,
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(nodeError(value, response.status));
      if (!isClearResult(value)) throw new Error('Nodo returned an invalid storage result.');
      return value;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? new Error(`Nodo storage could not be cleared. ${lastError.message}`)
    : new Error('Nodo storage could not be cleared. Keep the host online and use the same network.');
}

function uniqueLanCandidates(access: NodoAccess) {
  const seen = new Set<string>();
  return access.candidates.filter((candidate) => {
    const key = `${candidate.address}:${candidate.port}`;
    if (candidate.kind !== 'lan' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isClearResult(value: unknown): value is NodoStorageClearResult {
  if (typeof value !== 'object' || value === null) return false;
  return ['deletedBytes', 'deletedPosts', 'deletedUploads'].every((key) =>
    key in value && Number.isSafeInteger(value[key as keyof typeof value]) &&
    Number(value[key as keyof typeof value]) >= 0);
}

function nodeError(value: unknown, status: number): string {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
    ? value.error
    : `Nodo request failed (${status}).`;
}
