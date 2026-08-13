import type { LigoMessage } from '../domain/ligo';

export type LigoMessagePage = { messages: LigoMessage[]; nextCursor: string | null };

export interface LigoLocalStore {
  has(ownerId: string, messageId: string): Promise<boolean>;
  page(ownerId: string, conversationId: string, cursor: string | null, limit: number): Promise<LigoMessagePage>;
  put(ownerId: string, message: LigoMessage): Promise<void>;
}

export function createLigoLocalStore(): LigoLocalStore {
  return typeof indexedDB === 'undefined' ? new MemoryLigoLocalStore() : new IndexedDbLigoLocalStore();
}

export class MemoryLigoLocalStore implements LigoLocalStore {
  readonly #messages = new Map<string, LigoMessage>();

  async has(ownerId: string, messageId: string): Promise<boolean> {
    return this.#messages.has(`${ownerId}:${messageId}`);
  }

  async page(ownerId: string, conversationId: string, cursor: string | null, limit: number): Promise<LigoMessagePage> {
    const before = decodeCursor(cursor);
    const messages = [...this.#messages.entries()]
      .filter(([key, message]) => key.startsWith(`${ownerId}:`) && message.conversationId === conversationId &&
        (!before || message.createdAt < before.at || message.createdAt === before.at && message.id < before.id))
      .map(([, message]) => message)
      .sort(compareNewest)
      .slice(0, limit);
    return { messages, nextCursor: messages.length === limit ? encodeCursor(messages.at(-1)!) : null };
  }

  async put(ownerId: string, message: LigoMessage): Promise<void> {
    this.#messages.set(`${ownerId}:${message.id}`, structuredClone(message));
  }
}

class IndexedDbLigoLocalStore implements LigoLocalStore {
  readonly #database = openDatabase();

  async has(ownerId: string, messageId: string): Promise<boolean> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const request = database.transaction('messages', 'readonly').objectStore('messages')
        .getKey(`${ownerId}:${messageId}`);
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(request.error ?? new Error('Local messages could not be checked.'));
    });
  }

  async page(ownerId: string, conversationId: string, cursor: string | null, limit: number): Promise<LigoMessagePage> {
    const database = await this.#database;
    const before = decodeCursor(cursor);
    const lower = [ownerId, conversationId, 0, ''];
    const upper = [ownerId, conversationId, before?.at ?? Number.MAX_SAFE_INTEGER, before?.id ?? '\uffff'];
    const range = IDBKeyRange.bound(lower, upper, false, Boolean(before));
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('messages', 'readonly');
      const request = transaction.objectStore('messages').index('byConversation').openCursor(range, 'prev');
      const messages: LigoMessage[] = [];
      request.onerror = () => reject(request.error ?? new Error('Local messages could not be read.'));
      request.onsuccess = () => {
        const item = request.result;
        if (!item || messages.length >= limit) {
          resolve({ messages, nextCursor: messages.length === limit ? encodeCursor(messages.at(-1)!) : null });
          return;
        }
        messages.push(stripRecord(item.value as StoredMessage));
        item.continue();
      };
    });
  }

  async put(ownerId: string, message: LigoMessage): Promise<void> {
    const database = await this.#database;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('messages', 'readwrite');
      transaction.objectStore('messages').put({
        ...message,
        localKey: `${ownerId}:${message.id}`,
        ownerId,
      } satisfies StoredMessage);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Message could not be saved locally.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Message could not be saved locally.'));
    });
  }
}

type StoredMessage = LigoMessage & { localKey: string; ownerId: string };

const DATABASE_NAME = 'kaordo-ligo-v1';
const DATABASE_VERSION = 2;
const LEGACY_DATABASE_NAME = ['veri', 'dimensio-ligo-v1'].join('');
const LEGACY_MIGRATION_KEY = 'legacy-imported';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('messages')) {
        const store = request.result.createObjectStore('messages', { keyPath: 'localKey' });
        store.createIndex('byConversation', ['ownerId', 'conversationId', 'createdAt', 'id']);
      }
      if (!request.result.objectStoreNames.contains('meta')) {
        request.result.createObjectStore('meta');
      }
    };
    request.onsuccess = () => {
      migrateLegacyDatabase(request.result).then(() => resolve(request.result), reject);
    };
    request.onerror = () => reject(request.error ?? new Error('Local message database is unavailable.'));
  });
}

async function migrateLegacyDatabase(database: IDBDatabase): Promise<void> {
  if (await readKey(database, 'meta', LEGACY_MIGRATION_KEY) !== undefined) return;
  const legacy = await openLegacyDatabase();
  if (legacy) {
    const messages = await readAll<StoredMessage>(legacy, 'messages');
    legacy.close();
    if (messages.length > 0) await writeMessages(database, messages);
    indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
  }
  await writeKey(database, 'meta', LEGACY_MIGRATION_KEY, true);
}

function openLegacyDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let created = false;
    const request = indexedDB.open(LEGACY_DATABASE_NAME);
    request.onupgradeneeded = () => { created = true; };
    request.onsuccess = () => {
      if (created || !request.result.objectStoreNames.contains('messages')) {
        request.result.close();
        indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
        resolve(null);
      } else {
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Previous local messages could not be opened.'));
  });
}

function readAll<T>(database: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error('Previous local messages could not be read.'));
  });
}

function readKey(database: IDBDatabase, storeName: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local migration state could not be read.'));
  });
}

function writeKey(database: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local migration state could not be saved.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local migration state could not be saved.'));
  });
}

function writeMessages(database: IDBDatabase, messages: StoredMessage[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('messages', 'readwrite');
    const store = transaction.objectStore('messages');
    for (const message of messages) store.put(message);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Previous local messages could not be migrated.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Previous local messages could not be migrated.'));
  });
}

function stripRecord({ localKey: _localKey, ownerId: _ownerId, ...message }: StoredMessage): LigoMessage {
  return message;
}

function compareNewest(left: LigoMessage, right: LigoMessage): number {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
}

function encodeCursor(message: LigoMessage): string { return `${message.createdAt}:${message.id}`; }
function decodeCursor(value: string | null): { at: number; id: string } | null {
  const match = value?.match(/^(\d+):(.+)$/u);
  return match?.[1] && match[2] ? { at: Number(match[1]), id: match[2] } : null;
}
