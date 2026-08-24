const DATABASE_NAME = 'kaordo-canvas-media';
const DATABASE_VERSION = 1;
const STORE_NAME = 'media';
const memoryFallback = new Map<string, Blob>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

export async function saveCanvasMediaBlob(
  workspaceId: string,
  mediaId: string,
  blob: Blob,
): Promise<void> {
  const key = mediaKey(workspaceId, mediaId);
  const database = await openDatabase();
  if (!database) {
    memoryFallback.set(key, blob);
    return;
  }
  try {
    await transaction(database, 'readwrite', (store) => store.put({ blob, key }));
  } catch {
    // Private canvas media must remain usable when a WebView blocks or fills
    // IndexedDB. Keep the current session functional without hiding the blob.
    memoryFallback.set(key, blob);
  }
}

export async function loadCanvasMediaBlob(
  workspaceId: string,
  mediaId: string,
): Promise<Blob | null> {
  const key = mediaKey(workspaceId, mediaId);
  const memory = memoryFallback.get(key);
  if (memory) return memory;
  const database = await openDatabase();
  if (!database) return null;
  try {
    const value = await request<StoredMedia | undefined>(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key),
    );
    return value?.blob ?? memoryFallback.get(key) ?? null;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

export async function deleteCanvasMediaBlob(
  workspaceId: string,
  mediaId: string,
): Promise<void> {
  const key = mediaKey(workspaceId, mediaId);
  memoryFallback.delete(key);
  const database = await openDatabase();
  if (!database) return;
  await transaction(database, 'readwrite', (store) => store.delete(key)).catch(() => undefined);
}

function mediaKey(workspaceId: string, mediaId: string): string {
  return `${workspaceId}:${mediaId}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') {
    databasePromise = Promise.resolve(null);
    return databasePromise;
  }
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB request failed.'));
  });
}

function transaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const current = database.transaction(STORE_NAME, mode);
    current.oncomplete = () => resolve();
    current.onerror = () => reject(current.error ?? new Error('IndexedDB transaction failed.'));
    operation(current.objectStore(STORE_NAME));
  });
}

type StoredMedia = {
  blob: Blob;
  key: string;
};
