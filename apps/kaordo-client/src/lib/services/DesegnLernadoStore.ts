import {
  DESEGN_FOCUSES,
  EMPTY_DESEGN_PET,
  type DesegnFocus,
  type DesegnDrawing,
  type DesegnPetProfile,
} from '../domain/desegnLernado';

const DATABASE_NAME = 'kaordo-desegnlernado';
const DATABASE_VERSION = 1;
const DRAWINGS_STORE = 'drawings';
const MEDIA_STORE = 'media';
const PROFILES_STORE = 'profiles';

export type DesegnMediaVariant = 'original' | 'thumbnail';

export type DesegnLernadoArchive = {
  drawings: DesegnDrawing[];
  pet: DesegnPetProfile;
};

export interface DesegnLernadoStore {
  deleteDrawing(ownerId: string, drawingId: string): Promise<void>;
  load(ownerId: string): Promise<DesegnLernadoArchive>;
  loadMedia(ownerId: string, drawingId: string, variant: DesegnMediaVariant): Promise<Blob | null>;
  saveDrawing(
    ownerId: string,
    drawing: DesegnDrawing,
    original: Blob,
    thumbnail: Blob,
  ): Promise<void>;
  savePet(ownerId: string, pet: DesegnPetProfile): Promise<void>;
  updateDrawing(ownerId: string, drawing: DesegnDrawing): Promise<void>;
}

export function createDesegnLernadoStore(): DesegnLernadoStore {
  return typeof indexedDB === 'undefined'
    ? new MemoryDesegnLernadoStore()
    : new IndexedDbDesegnLernadoStore();
}

export class MemoryDesegnLernadoStore implements DesegnLernadoStore {
  readonly drawings = new Map<string, StoredDrawing>();
  readonly media = new Map<string, Blob>();
  readonly profiles = new Map<string, DesegnPetProfile>();

  async load(ownerId: string): Promise<DesegnLernadoArchive> {
    const drawings = [...this.drawings.values()]
      .filter((entry) => entry.ownerId === ownerId)
      .map((entry) => readDrawing(entry.drawing))
      .filter((drawing): drawing is DesegnDrawing => drawing !== null)
      .sort(sortDrawings);
    return {
      drawings,
      pet: clonePet(this.profiles.get(ownerId) ?? EMPTY_DESEGN_PET),
    };
  }

  async saveDrawing(ownerId: string, drawing: DesegnDrawing, original: Blob, thumbnail: Blob): Promise<void> {
    this.drawings.set(drawingKey(ownerId, drawing.id), {
      drawing: cloneDrawing(drawing),
      key: drawingKey(ownerId, drawing.id),
      ownerId,
    });
    this.media.set(mediaKey(ownerId, drawing.id, 'original'), original);
    this.media.set(mediaKey(ownerId, drawing.id, 'thumbnail'), thumbnail);
  }

  async updateDrawing(ownerId: string, drawing: DesegnDrawing): Promise<void> {
    const key = drawingKey(ownerId, drawing.id);
    if (!this.drawings.has(key)) throw new Error('Drawing not found.');
    this.drawings.set(key, { drawing: cloneDrawing(drawing), key, ownerId });
  }

  async deleteDrawing(ownerId: string, drawingId: string): Promise<void> {
    this.drawings.delete(drawingKey(ownerId, drawingId));
    this.media.delete(mediaKey(ownerId, drawingId, 'original'));
    this.media.delete(mediaKey(ownerId, drawingId, 'thumbnail'));
  }

  async loadMedia(ownerId: string, drawingId: string, variant: DesegnMediaVariant): Promise<Blob | null> {
    return this.media.get(mediaKey(ownerId, drawingId, variant)) ?? null;
  }

  async savePet(ownerId: string, pet: DesegnPetProfile): Promise<void> {
    this.profiles.set(ownerId, clonePet(pet));
  }
}

class IndexedDbDesegnLernadoStore implements DesegnLernadoStore {
  #databasePromise: Promise<IDBDatabase> | null = null;

  async load(ownerId: string): Promise<DesegnLernadoArchive> {
    try {
      const database = await this.database();
      const transaction = database.transaction([DRAWINGS_STORE, PROFILES_STORE], 'readonly');
      const drawingRequest = transaction.objectStore(DRAWINGS_STORE).index('byOwner').getAll(ownerId);
      const profileRequest = transaction.objectStore(PROFILES_STORE).get(ownerId);
      const [records, profile] = await Promise.all([
        request<StoredDrawing[]>(drawingRequest),
        request<StoredProfile | undefined>(profileRequest),
        completed(transaction),
      ]);
      return {
        drawings: (Array.isArray(records) ? records : [])
          .map((entry) => readDrawing(entry?.drawing))
          .filter((drawing): drawing is DesegnDrawing => drawing !== null)
          .sort(sortDrawings),
        pet: clonePet(profile?.pet ?? EMPTY_DESEGN_PET),
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  async saveDrawing(ownerId: string, drawing: DesegnDrawing, original: Blob, thumbnail: Blob): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction([DRAWINGS_STORE, MEDIA_STORE], 'readwrite');
      transaction.objectStore(DRAWINGS_STORE).put({
        drawing: cloneDrawing(drawing),
        key: drawingKey(ownerId, drawing.id),
        ownerId,
      } satisfies StoredDrawing);
      const mediaStore = transaction.objectStore(MEDIA_STORE);
      mediaStore.put({ blob: original, key: mediaKey(ownerId, drawing.id, 'original') } satisfies StoredMedia);
      mediaStore.put({ blob: thumbnail, key: mediaKey(ownerId, drawing.id, 'thumbnail') } satisfies StoredMedia);
      await completed(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async updateDrawing(ownerId: string, drawing: DesegnDrawing): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction(DRAWINGS_STORE, 'readwrite');
      transaction.objectStore(DRAWINGS_STORE).put({
        drawing: cloneDrawing(drawing),
        key: drawingKey(ownerId, drawing.id),
        ownerId,
      } satisfies StoredDrawing);
      await completed(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async deleteDrawing(ownerId: string, drawingId: string): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction([DRAWINGS_STORE, MEDIA_STORE], 'readwrite');
      transaction.objectStore(DRAWINGS_STORE).delete(drawingKey(ownerId, drawingId));
      const mediaStore = transaction.objectStore(MEDIA_STORE);
      mediaStore.delete(mediaKey(ownerId, drawingId, 'original'));
      mediaStore.delete(mediaKey(ownerId, drawingId, 'thumbnail'));
      await completed(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async loadMedia(ownerId: string, drawingId: string, variant: DesegnMediaVariant): Promise<Blob | null> {
    try {
      const database = await this.database();
      const value = await request<StoredMedia | undefined>(
        database.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE)
          .get(mediaKey(ownerId, drawingId, variant)),
      );
      return value?.blob ?? null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async savePet(ownerId: string, pet: DesegnPetProfile): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction(PROFILES_STORE, 'readwrite');
      transaction.objectStore(PROFILES_STORE).put({ ownerId, pet: clonePet(pet) } satisfies StoredProfile);
      await completed(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  private database(): Promise<IDBDatabase> {
    if (this.#databasePromise) return this.#databasePromise;
    const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const operation = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      operation.onupgradeneeded = () => {
        const database = operation.result;
        if (!database.objectStoreNames.contains(DRAWINGS_STORE)) {
          const drawings = database.createObjectStore(DRAWINGS_STORE, { keyPath: 'key' });
          drawings.createIndex('byOwner', 'ownerId', { unique: false });
        }
        if (!database.objectStoreNames.contains(MEDIA_STORE)) {
          database.createObjectStore(MEDIA_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(PROFILES_STORE)) {
          database.createObjectStore(PROFILES_STORE, { keyPath: 'ownerId' });
        }
      };
      operation.onsuccess = () => {
        const database = operation.result;
        // Another tab can upgrade the archive while this window is open. A
        // closed connection must not remain cached forever or every later
        // gallery request will fail with "transaction is closed".
        database.onversionchange = () => {
          database.close();
          this.#databasePromise = null;
        };
        resolve(database);
      };
      operation.onerror = () => reject(operation.error ?? new Error('Could not open drawing storage.'));
      operation.onblocked = () => reject(new Error('Drawing storage is blocked by another window.'));
    });
    this.#databasePromise = databasePromise.catch((error) => {
      this.#databasePromise = null;
      throw error;
    });
    return this.#databasePromise;
  }
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('Drawing storage request failed.'));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Drawing storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Drawing storage transaction was cancelled.'));
  });
}

function storageError(error: unknown): Error {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error('Local drawing storage is full. Remove an old drawing or free device space.');
  }
  if (error instanceof Error && error.message) return error;
  return new Error('The drawing could not be saved locally.');
}

function cloneDrawing(drawing: DesegnDrawing): DesegnDrawing {
  // Writes originate from the typed state layer. Keep this copy helper small
  // and deterministic; reads use readDrawing below to protect the UI from
  // malformed records left by an interrupted older build.
  return {
    ...drawing,
    description: drawing.description.trim().slice(0, 2_000),
    shortcomings: [...new Set(drawing.shortcomings.map((item) => item.trim()).filter(Boolean))]
      .slice(0, 20)
      .map((item) => item.slice(0, 300)),
    title: drawing.title.trim().slice(0, 100) || 'Untitled drawing',
  };
}

function clonePet(value: unknown): DesegnPetProfile {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
  const name = boundedString(source.name, 24).replace(/\s+/g, ' ');
  const seen = new Set<string>();
  const rawEquipped = Array.isArray(source.equippedArtifactIds) ? source.equippedArtifactIds : [];
  const equippedArtifactIds = Array.from({ length: 3 }, (_, index) => {
    const value = rawEquipped[index];
    const id = typeof value === 'string' ? value.trim().slice(0, 128) : '';
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  const palette = source.palette;
  return {
    equippedArtifactIds,
    name: name || EMPTY_DESEGN_PET.name,
    palette: palette === 'ink' || palette === 'mint' || palette === 'sunset' || palette === 'night'
      ? palette
      : EMPTY_DESEGN_PET.palette,
  };
}

type UnknownRecord = Record<string, unknown>;

function readDrawing(value: unknown): DesegnDrawing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as UnknownRecord;
  const id = boundedString(source.id, 128);
  if (!id) return null;
  const createdAt = finite(source.createdAt, Date.now());
  const width = positiveFinite(source.width, 1);
  const height = positiveFinite(source.height, 1);
  const title = boundedString(source.title, 100) || 'Untitled drawing';
  const fileName = boundedString(source.fileName, 255) || `${title}.png`;
  const mimeType = boundedString(source.mimeType, 100).toLowerCase() || 'image/png';
  const shortcomings = Array.isArray(source.shortcomings)
    ? [...new Set(source.shortcomings
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))].slice(0, 20).map((item) => item.slice(0, 300))
    : [];
  const rating = source.rating === null || source.rating === undefined
    ? null
    : finite(source.rating, 0) > 0 ? Math.min(5, Math.max(1, Math.round(finite(source.rating, 1)))) : null;
  const focus = DESEGN_FOCUSES.includes(source.focus as DesegnFocus) ? source.focus as DesegnFocus : 'other';
  return {
    byteSize: Math.max(0, finite(source.byteSize, 0)),
    createdAt,
    description: boundedString(source.description, 2_000),
    fileName,
    focus,
    height,
    id,
    lastReviewedAt: nullableFinite(source.lastReviewedAt),
    mimeType,
    nextReviewAt: finite(source.nextReviewAt, createdAt),
    rating,
    reviewCount: Math.max(0, Math.round(finite(source.reviewCount, 0))),
    shortcomings,
    title,
    updatedAt: finite(source.updatedAt, createdAt),
    width,
  };
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveFinite(value: unknown, fallback: number): number {
  const number = finite(value, fallback);
  return number > 0 ? Math.min(number, 12_000) : fallback;
}

function nullableFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sortDrawings(left: DesegnDrawing, right: DesegnDrawing): number {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
}

function drawingKey(ownerId: string, drawingId: string): string {
  return `${ownerId}:${drawingId}`;
}

function mediaKey(ownerId: string, drawingId: string, variant: DesegnMediaVariant): string {
  return `${ownerId}:${drawingId}:${variant}`;
}

type StoredDrawing = { drawing: DesegnDrawing; key: string; ownerId: string };
type StoredMedia = { blob: Blob; key: string };
type StoredProfile = { ownerId: string; pet: DesegnPetProfile };
