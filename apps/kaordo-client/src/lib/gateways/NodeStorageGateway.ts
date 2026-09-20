import type {
  NodoAccess,
  NodoNodeUsage,
  NodoStorageClearResult,
  NodoStorageItem,
  NodoStorageItemKind,
  NodoStorageMoveProgress,
  NodoStorageMoveProgressHandler,
  NodoStorageMoveResult,
  NodoStorageSpace,
} from '../domain/nodo';
import type { NodoGateway } from './NodoGateway';
import { NodeConnection } from './NodeFluoGateway';
import { nodoOrigin, orderedNodoCandidates } from './NodoRoute';
import { allSettledConcurrent } from '../services/async';

const REQUEST_TIMEOUT_MS = 6_000;
const DIRECT_REQUEST_TIMEOUT_MS = 2_000;
const CLEAR_REQUEST_TIMEOUT_MS = 30_000;
const USAGE_REQUEST_DEADLINE_MS = 4_000;
const MOVE_CONTROL_TIMEOUT_MS = 60_000;
const MOVE_FILE_TIMEOUT_MINIMUM_MS = 120_000;
const STORAGE_MOVE_HEADER = 'x-kaordo-storage-move';
const STORAGE_MOVE_METADATA_HEADER = 'x-kaordo-storage-metadata';
const CHUNK_LENGTH_HEADER = 'x-kaordo-chunk-length';
const SOURCE_DELETE_CONCURRENCY = 4;

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

/**
 * Copies every completed item between two space-aware Nodos, commits the
 * coordinator routes, and only then removes the source copies. The host
 * transfer endpoints preserve IDs and authors, which is required for public
 * content shared by accounts other than the owner of the physical Nodo.
 */
export async function moveNodeStorage(
  nodes: NodoGateway,
  sourceNodeId: string,
  targetNodeId: string,
  moveId: string,
  onProgress: NodoStorageMoveProgressHandler | undefined,
  complete: () => Promise<void>,
  cancel: () => Promise<void>,
): Promise<NodoStorageMoveResult> {
  let items: NodoStorageItem[] = [];
  let source: NodeConnection;
  let target: NodeConnection;
  try {
    const [sourceAccess, targetAccess] = await Promise.all([
      nodes.accessNode(sourceNodeId),
      nodes.accessNode(targetNodeId),
    ]);
    const [privateItems, publicItems] = await Promise.all([
      listNodeStorageItems(sourceAccess, 'private'),
      listNodeStorageItems(sourceAccess, 'public'),
    ]).catch((error) => {
      throw moveError('Reading the source Nodo content failed.', error);
    });
    items = [...privateItems, ...publicItems];
    if (items.some((item) => !item.completed)) {
      throw new Error('Complete or delete partial uploads before moving this Nodo.');
    }
    try {
      [source, target] = await Promise.all([
        NodeConnection.open(nodes, sourceNodeId, sourceAccess),
        NodeConnection.open(nodes, targetNodeId, targetAccess),
      ]);
    } catch (error) {
      throw moveError('Opening the Nodos failed.', error);
    }
  } catch (error) {
    await cancel().catch(() => undefined);
    throw error;
  }
  const imported: NodoStorageItem[] = [];
  const files = items.filter((item) => item.kind === 'file');
  const records = items.filter((item) => item.kind !== 'file');
  const totalBytes = items.reduce((total, item) => total + item.sizeBytes, 0);
  let completedBytes = 0;
  let currentItem = 0;
  const report = (phase: NodoStorageMoveProgress['phase'], bytes = completedBytes) => {
    onProgress?.({
      completedBytes: Math.min(totalBytes, Math.max(0, bytes)),
      currentItem,
      phase,
      totalBytes,
      totalItems: items.length,
    });
  };
  report('copying');
  try {
    for (const item of files) {
      imported.push(item);
      try {
        await copyFile(source, target, item, moveId, (uploadedBytes) => {
          report('copying', completedBytes + uploadedBytes);
        });
      } catch (error) {
        throw moveError(`Copying file “${item.name}” to the destination Nodo failed.`, error);
      }
      completedBytes += item.sizeBytes;
      currentItem += 1;
      report('copying');
    }
    for (const item of records) {
      imported.push(item);
      try {
        await copyRecord(source, target, item, moveId);
      } catch (error) {
        throw moveError(`Copying ${item.kind} “${item.name}” to the destination Nodo failed.`, error);
      }
      completedBytes += item.sizeBytes;
      currentItem += 1;
      report('copying');
    }
  } catch (error) {
    await cleanupImported(target, imported, moveId);
    await cancel().catch(() => undefined);
    throw error;
  }

  try {
    report('committing', totalBytes);
    await complete();
    report('removing', totalBytes);
  } catch (error) {
    await cleanupImported(target, imported, moveId);
    await cancel().catch(() => undefined);
    throw error;
  }

  // Metadata deletion also removes attached files on the Nodo. Keep the
  // explicit file pass for standalone uploads and idempotent cleanup. Do not
  // stop at the first failure: otherwise one locked item strands every later
  // source item even though the move has already been committed.
  const removalItems = [...records, ...files];
  const removalResults = await allSettledConcurrent(
    removalItems,
    SOURCE_DELETE_CONCURRENCY,
    (item) => deleteTransferItem(source, item, moveId),
  );
  const removalFailures = removalResults
    .map((result, index) => result.status === 'rejected' ? { error: result.reason, item: removalItems[index]! } : null)
    .filter((failure): failure is { error: unknown; item: NodoStorageItem } => failure !== null);
  if (removalFailures.length) {
    const first = removalFailures[0]!;
    const detail = first.error instanceof Error ? ` ${first.error.message}` : '';
    throw new Error(
      `The content moved, but ${removalFailures.length} source item${removalFailures.length === 1 ? '' : 's'} could not be removed. Keep both Nodos online and retry.${detail}`,
    );
  }
  await cancel().catch(() => undefined);
  return { movedItems: items.length };
}

async function copyFile(
  source: NodeConnection,
  target: NodeConnection,
  item: NodoStorageItem,
  moveId: string,
  onProgress: (uploadedBytes: number) => void,
): Promise<void> {
  const response = await source.fetch(contentPath(item), {
    headers: { [STORAGE_MOVE_HEADER]: moveId },
  }, fileTimeout(item.sizeBytes));
  const size = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 0 || size !== item.sizeBytes || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Nodo returned invalid file data for “${item.name}”.`);
  }
  const body = await response.blob();
  if (body.size !== size) {
    throw new Error(`Nodo returned incomplete file data for “${item.name}”.`);
  }
  const headers = new Headers({
    'content-type': item.mimeType ?? 'application/octet-stream',
    [CHUNK_LENGTH_HEADER]: String(size),
    [STORAGE_MOVE_HEADER]: moveId,
    [STORAGE_MOVE_METADATA_HEADER]: encodeHeader(JSON.stringify({
      createdAt: item.createdAt,
      mimeType: item.mimeType,
      name: item.name,
      owner: item.owner,
    })),
  });
  await target.upload(movePath(item), body, {
    headers,
    method: 'PUT',
  }, (uploadedBytes) => onProgress(Math.min(size, uploadedBytes)), fileTimeout(size));
}

async function copyRecord(
  source: NodeConnection,
  target: NodeConnection,
  item: NodoStorageItem,
  moveId: string,
): Promise<void> {
  const value = await source.json<Record<string, unknown>>(
    movePath(item),
    { headers: { [STORAGE_MOVE_HEADER]: moveId } },
    MOVE_CONTROL_TIMEOUT_MS,
  );
  await target.json(movePath(item), {
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json', [STORAGE_MOVE_HEADER]: moveId },
    method: 'POST',
  }, MOVE_CONTROL_TIMEOUT_MS);
}

async function cleanupImported(
  target: NodeConnection,
  imported: readonly NodoStorageItem[],
  moveId: string,
): Promise<void> {
  for (const item of [...imported].reverse()) {
    await deleteTransferItem(target, item, moveId).catch(() => undefined);
  }
}

async function deleteTransferItem(
  connection: NodeConnection,
  item: NodoStorageItem,
  moveId: string,
): Promise<void> {
  try {
    await connection.json(movePath(item), {
      headers: { [STORAGE_MOVE_HEADER]: moveId },
      method: 'DELETE',
    }, MOVE_CONTROL_TIMEOUT_MS);
  } catch (error) {
    // Cleanup is intentionally idempotent: a metadata record may already
    // have removed one of its attachment files.
    if (error instanceof Error && /not found/i.test(error.message)) return;
    throw error;
  }
}

function contentPath(item: NodoStorageItem): string {
  const base = item.space === 'private' ? '/v1/files' : '/v1/spaces/public/content';
  return `${base}/${encodeURIComponent(item.id)}`;
}

function movePath(item: NodoStorageItem): string {
  return `/v1/storage/move/${item.space}/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.storageKey)}`;
}

function fileTimeout(size: number): number {
  return Math.max(MOVE_FILE_TIMEOUT_MINIMUM_MS, Math.ceil(Math.max(0, size) / 64_000) * 1_000);
}

function encodeHeader(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
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
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${access.ticket}`);
  try {
    const response = await fetch(`${nodoOrigin(candidate)}${path}`, {
      ...init,
      cache: 'no-store',
      headers,
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

function moveError(prefix: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return new Error(detail ? `${prefix} ${detail}` : prefix);
}
