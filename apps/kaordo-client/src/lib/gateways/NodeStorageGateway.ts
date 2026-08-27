import type {
  NodoAccess,
  NodoNodeUsage,
  NodoStorageClearResult,
  NodoStorageItem,
  NodoStorageItemKind,
  NodoStorageSpace,
} from '../domain/nodo';
import { nodoOrigin, orderedNodoCandidates } from './NodoRoute';

const REQUEST_TIMEOUT_MS = 6_000;
const DIRECT_REQUEST_TIMEOUT_MS = 2_000;
const CLEAR_REQUEST_TIMEOUT_MS = 30_000;
const USAGE_REQUEST_DEADLINE_MS = 4_000;

export async function clearNodeStorage(access: NodoAccess): Promise<NodoStorageClearResult> {
  return clearStorageAt(access, '/v1/storage');
}

export async function clearPrivateNodeStorage(access: NodoAccess): Promise<NodoStorageClearResult> {
  return clearStorageAt(access, '/v1/spaces/private/storage');
}

export async function readNodeUsage(access: NodoAccess): Promise<NodoNodeUsage> {
  const value = await requestAt(access, '/v1/status', {}, USAGE_REQUEST_DEADLINE_MS);
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
  for (const candidate of orderedNodoCandidates(access)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLEAR_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${nodoOrigin(candidate)}${path}`, {
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

async function requestAt(
  access: NodoAccess,
  path: string,
  init: RequestInit = {},
  totalDeadlineMilliseconds?: number,
): Promise<unknown> {
  const candidates = orderedNodoCandidates(access);
  const readOnly = !init.method || init.method === 'GET' || init.method === 'HEAD';
  const deadline = totalDeadlineMilliseconds === undefined
    ? null
    : Date.now() + totalDeadlineMilliseconds;
  let lastError: unknown = null;
  for (const candidate of candidates) {
    const remaining = deadline === null ? null : deadline - Date.now();
    if (remaining !== null && remaining <= 0) break;
    try {
      // Keep a read ordered and cancellable instead of racing every route.
      // The old Promise.any path sent the same request to LAN, public IPv6,
      // and the Worker relay at once, multiplying traffic on the free tier.
      // Direct routes get a short probe; the relay gets its normal budget.
      const routeTimeout = readOnly && candidate.kind !== 'relay'
        ? DIRECT_REQUEST_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS;
      const timeout = remaining === null ? routeTimeout : Math.min(routeTimeout, remaining);
      return await requestCandidate(access, candidate, path, init, new AbortController(), timeout);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? new Error(`Nodo storage could not be reached. ${lastError.message}`)
    : new Error('Nodo storage could not be reached. Keep the host online and use the same network.');
}

async function requestCandidate(
  access: NodoAccess,
  candidate: NodoAccess['candidates'][number],
  path: string,
  init: RequestInit,
  controller = new AbortController(),
  timeoutMilliseconds = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(`${nodoOrigin(candidate)}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${access.ticket}` },
      signal: controller.signal,
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(nodeError(value, response.status));
    return value;
  } finally {
    clearTimeout(timer);
  }
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
  if (!isSpaceUsage(spaces.private) || !isSpaceUsage(spaces.public)) return false;
  const privateSpace = spaces.private as { quotaBytes: number; usedBytes: number };
  const publicSpace = spaces.public as { quotaBytes: number; usedBytes: number };
  return privateSpace.usedBytes + publicSpace.usedBytes === record.usedBytes &&
    record.usedBytes <= privateSpace.quotaBytes + publicSpace.quotaBytes;
}

function isSpaceUsage(value: unknown): value is { quotaBytes: number; usedBytes: number } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record.quotaBytes) && Number(record.quotaBytes) >= 0 &&
    Number.isSafeInteger(record.usedBytes) && Number(record.usedBytes) >= 0 &&
    Number(record.usedBytes) <= Number(record.quotaBytes);
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
