import type {
  NodoAccess,
  NodoNodeUsage,
  NodoStorageClearResult,
  NodoStorageItem,
  NodoStorageItemKind,
  NodoStorageSpace,
} from '../domain/nodo';

const REQUEST_TIMEOUT_MS = 30_000;

export async function clearNodeStorage(access: NodoAccess): Promise<NodoStorageClearResult> {
  return clearStorageAt(access, '/v1/storage');
}

export async function clearPrivateNodeStorage(access: NodoAccess): Promise<NodoStorageClearResult> {
  return clearStorageAt(access, '/v1/spaces/private/storage');
}

export async function readNodeUsage(access: NodoAccess): Promise<NodoNodeUsage> {
  const value = await requestAt(access, '/v1/status');
  if (!isNodeUsage(value)) throw new Error('Nodo returned invalid storage usage.');
  return value;
}

export async function listNodeStorageItems(
  access: NodoAccess,
  space: NodoStorageSpace,
): Promise<NodoStorageItem[]> {
  const value = await requestAt(access, `/v1/storage/items/${space}`);
  if (!isStorageItems(value)) throw new Error('Nodo returned invalid storage items.');
  return value.items.map((item) => ({
    ...item,
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : null,
    nodeId: access.node.id,
    nodeName: access.node.deviceName,
    preview: typeof item.preview === 'string' ? item.preview : null,
    space,
  }));
}

export async function deleteNodeStorageItem(
  access: NodoAccess,
  space: NodoStorageSpace,
  kind: NodoStorageItemKind,
  storageKey: string,
): Promise<void> {
  const value = await requestAt(
    access,
    `/v1/storage/items/${space}/${encodeURIComponent(kind)}/${encodeURIComponent(storageKey)}`,
    { method: 'DELETE' },
  );
  if (!isOk(value)) throw new Error('Nodo returned an invalid deletion result.');
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

async function requestAt(access: NodoAccess, path: string, init: RequestInit = {}): Promise<unknown> {
  let lastError: unknown = null;
  for (const candidate of uniqueLanCandidates(access)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const host = candidate.address.includes(':') ? `[${candidate.address}]` : candidate.address;
      const response = await fetch(`http://${host}:${candidate.port}${path}`, {
        ...init,
        cache: 'no-store',
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${access.ticket}` },
        signal: controller.signal,
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(nodeError(value, response.status));
      return value;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? new Error(`Nodo storage could not be reached. ${lastError.message}`)
    : new Error('Nodo storage could not be reached. Keep the host online and use the same network.');
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

function isNodeUsage(value: unknown): value is NodoNodeUsage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.usedBytes) || Number(record.usedBytes) < 0) return false;
  if (typeof record.spaces !== 'object' || record.spaces === null) return false;
  const spaces = record.spaces as Record<string, unknown>;
  return isSpaceUsage(spaces.private) && isSpaceUsage(spaces.public);
}

function isSpaceUsage(value: unknown): value is { quotaBytes: number; usedBytes: number } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record.quotaBytes) && Number(record.quotaBytes) >= 0 &&
    Number.isSafeInteger(record.usedBytes) && Number(record.usedBytes) >= 0;
}

type StorageItemWire = {
  completed: boolean;
  createdAt: number;
  deletable: boolean;
  id: string;
  kind: NodoStorageItemKind;
  mimeType?: unknown;
  name: string;
  owner: string;
  preview?: unknown;
  sizeBytes: number;
  storageKey: string;
};

function isStorageItems(value: unknown): value is { items: StorageItemWire[] } {
  if (typeof value !== 'object' || value === null) return false;
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return false;
  return items.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    const record = item as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.storageKey === 'string' &&
      isStorageItemKind(record.kind) && typeof record.name === 'string' &&
      typeof record.owner === 'string' && Number.isFinite(record.sizeBytes) &&
      Number.isFinite(record.createdAt) && typeof record.completed === 'boolean' &&
      typeof record.deletable === 'boolean';
  });
}

function isStorageItemKind(value: unknown): value is NodoStorageItemKind {
  return value === 'file' || value === 'fluo-post' || value === 'ligo-envelope' || value === 'rondo-message';
}

function isOk(value: unknown): value is { ok: true } {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).ok === true;
}

function nodeError(value: unknown, status: number): string {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
    ? value.error
    : `Nodo request failed (${status}).`;
}
