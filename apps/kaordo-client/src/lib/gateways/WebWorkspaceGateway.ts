import {
  normalizeWorkspaceDetail,
  normalizeObjectSummary,
  workspaceSummary,
  copyObjectDocument,
  EMPTY_OBJECT_DOCUMENT,
  normalizeWorkspaceCanvasDocument,
  type WorkspaceCanvasDocument,
  type ObjectDocument,
  type ObjectSummary,
  type WorkspaceDetail,
  type WorkspaceLibrary,
} from '../domain/workspace';
import type { WorkspaceGateway } from './WorkspaceGateway';

const DEFAULT_STORAGE_KEY = 'kaordo.workspace-library.v1';
const LEGACY_STORAGE_KEY = ['veri', 'dimensio.workspace-library.v1'].join('');
const WORKSPACE_FORMAT_VERSION = 1;
const MAX_NAME_BYTES = 200;
const MAX_OBJECT_TITLE_BYTES = 200;

type StoredWorkspace = WorkspaceDetail & {
  canvasDocument: WorkspaceCanvasDocument;
  createdAtUnixMs: number;
};

type StoredLibrary = {
  version: typeof WORKSPACE_FORMAT_VERSION;
  workspaces: StoredWorkspace[];
};

export type WebWorkspaceGatewayOptions = {
  createId?: () => string;
  now?: () => number;
  storage?: Storage;
  storageKey?: string;
};

export class WebWorkspaceGateway implements WorkspaceGateway {
  readonly platform = 'web' as const;
  readonly #createId: () => string;
  readonly #now: () => number;
  readonly #providedStorage?: Storage;
  readonly #legacyStorageKey: string | null;
  readonly #storageKey: string;

  constructor(options: WebWorkspaceGatewayOptions = {}) {
    this.#createId = options.createId ?? createUuidV7;
    this.#now = options.now ?? Date.now;
    this.#providedStorage = options.storage;
    this.#legacyStorageKey = options.storageKey === undefined ? LEGACY_STORAGE_KEY : null;
    this.#storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  }

  async listWorkspaces(): Promise<WorkspaceLibrary> {
    const workspaces = [...this.#readLibrary().workspaces].sort(
      (left, right) =>
        right.createdAtUnixMs - left.createdAtUnixMs ||
        left.name.localeCompare(right.name),
    );
    return {
      files: workspaces.map(workspaceSummary),
      warnings: [],
    };
  }

  async createWorkspace(requestedName: string): Promise<WorkspaceDetail> {
    const name = normalizeWorkspaceName(requestedName);
    const library = this.#readLibrary();
    if (
      library.workspaces.some(
        (workspace) => workspace.name.localeCompare(name, undefined, {
          sensitivity: 'accent',
        }) === 0,
      )
    ) {
      throw new Error(`A workspace named ${name}.vdw already exists.`);
    }

    const id = this.#createId();
    const workspace: StoredWorkspace = {
      createdAtUnixMs: this.#now(),
      canvasDocument: { elements: [], placements: [], version: 1 },
      id,
      name,
      objects: [],
      path: `localstorage://Kaordo/${id}.vdw`,
      warnings: [],
    };
    this.#writeLibrary({
      ...library,
      workspaces: [workspace, ...library.workspaces],
    });
    return normalizeWorkspaceDetail(workspace);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const library = this.#readLibrary();
    if (!library.workspaces.some((workspace) => workspace.id === workspaceId)) {
      throw new Error('The workspace could not be found.');
    }
    this.#writeLibrary({
      ...library,
      workspaces: library.workspaces.filter(
        (workspace) => workspace.id !== workspaceId,
      ),
    });
  }

  async openWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
    const workspace = this.#readLibrary().workspaces.find(
      (candidate) => candidate.id === workspaceId,
    );
    if (!workspace) throw new Error('The workspace could not be found.');
    return normalizeWorkspaceDetail(workspace);
  }

  async createObject(workspaceId: string, requestedTitle: string): Promise<ObjectSummary> {
    const title = normalizeObjectTitle(requestedTitle);
    const library = this.#readLibrary();
    const workspaceIndex = library.workspaces.findIndex(
      (workspace) => workspace.id === workspaceId,
    );
    if (workspaceIndex < 0) throw new Error('The workspace could not be found.');

    const object: ObjectSummary = {
      document: copyObjectDocument(EMPTY_OBJECT_DOCUMENT),
      id: this.#createId(),
      title,
      type: 'Knowledge object',
    };
    const workspace = library.workspaces[workspaceIndex];
    const updatedWorkspace: StoredWorkspace = {
      ...workspace,
      objects: [object, ...workspace.objects],
    };
    const workspaces = [...library.workspaces];
    workspaces[workspaceIndex] = updatedWorkspace;
    this.#writeLibrary({ ...library, workspaces });
    return { ...object };
  }

  async deleteObject(workspaceId: string, objectId: string): Promise<void> {
    const library = this.#readLibrary();
    const workspaceIndex = library.workspaces.findIndex(
      (workspace) => workspace.id === workspaceId,
    );
    if (workspaceIndex < 0) throw new Error('The workspace could not be found.');
    const workspace = library.workspaces[workspaceIndex];
    if (!workspace.objects.some((object) => object.id === objectId)) {
      throw new Error('The object could not be found.');
    }
    const workspaces = [...library.workspaces];
    workspaces[workspaceIndex] = {
      ...workspace,
      canvasDocument: {
        ...workspace.canvasDocument,
        elements: workspace.canvasDocument.elements.filter(
          (element) => element.parentObjectId !== objectId,
        ),
        placements: workspace.canvasDocument.placements.filter(
          (placement) => placement.objectId !== objectId,
        ),
      },
      objects: workspace.objects.filter((object) => object.id !== objectId),
    };
    this.#writeLibrary({ ...library, workspaces });
  }

  async updateObjectDocument(
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ): Promise<ObjectSummary> {
    const library = this.#readLibrary();
    const workspaceIndex = library.workspaces.findIndex(
      (workspace) => workspace.id === workspaceId,
    );
    if (workspaceIndex < 0) throw new Error('The workspace could not be found.');
    const workspace = library.workspaces[workspaceIndex];
    const objectIndex = workspace.objects.findIndex((object) => object.id === objectId);
    if (objectIndex < 0) throw new Error('The object could not be found.');

    const object: ObjectSummary = {
      ...workspace.objects[objectIndex],
      document: copyObjectDocument(document),
    };
    const objects = [...workspace.objects];
    objects[objectIndex] = object;
    const workspaces = [...library.workspaces];
    workspaces[workspaceIndex] = { ...workspace, objects };
    this.#writeLibrary({ ...library, workspaces });
    return normalizeObjectSummary(object);
  }

  async loadCanvasDocument(workspaceId: string): Promise<WorkspaceCanvasDocument> {
    const workspace = this.#readLibrary().workspaces.find(
      (candidate) => candidate.id === workspaceId,
    );
    if (!workspace) throw new Error('The workspace could not be found.');
    return normalizeWorkspaceCanvasDocument(workspace.canvasDocument);
  }

  async saveCanvasDocument(
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ): Promise<void> {
    const library = this.#readLibrary();
    const workspaceIndex = library.workspaces.findIndex(
      (workspace) => workspace.id === workspaceId,
    );
    if (workspaceIndex < 0) throw new Error('The workspace could not be found.');
    const workspaces = [...library.workspaces];
    workspaces[workspaceIndex] = {
      ...workspaces[workspaceIndex],
      canvasDocument: normalizeWorkspaceCanvasDocument(document),
    };
    this.#writeLibrary({ ...library, workspaces });
  }

  #storage(): Storage {
    if (this.#providedStorage) return this.#providedStorage;
    if (typeof globalThis.localStorage === 'undefined') {
      throw new Error('Browser storage is unavailable.');
    }
    return globalThis.localStorage;
  }

  #readLibrary(): StoredLibrary {
    const storage = this.#storage();
    const current = storage.getItem(this.#storageKey);
    const legacy = current === null && this.#legacyStorageKey
      ? storage.getItem(this.#legacyStorageKey)
      : null;
    const serialized = current ?? legacy;
    if (serialized === null) {
      return { version: WORKSPACE_FORMAT_VERSION, workspaces: [] };
    }

    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error('The browser workspace library is invalid.');
    }
    const library = parseStoredLibrary(value);
    if (current === null && legacy !== null && this.#legacyStorageKey) {
      storage.setItem(this.#storageKey, JSON.stringify(library));
      storage.removeItem(this.#legacyStorageKey);
    }
    return library;
  }

  #writeLibrary(library: StoredLibrary) {
    this.#storage().setItem(this.#storageKey, JSON.stringify(library));
  }
}

function parseStoredLibrary(value: unknown): StoredLibrary {
  if (!isRecord(value) || value.version !== WORKSPACE_FORMAT_VERSION) {
    throw new Error('The browser workspace library version is unsupported.');
  }
  if (!Array.isArray(value.workspaces)) {
    throw new Error('The browser workspace library is invalid.');
  }
  return {
    version: WORKSPACE_FORMAT_VERSION,
    workspaces: value.workspaces.map(parseStoredWorkspace),
  };
}

function parseStoredWorkspace(value: unknown): StoredWorkspace {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.path !== 'string' ||
    (value.warning !== undefined && typeof value.warning !== 'string') ||
    (value.createdAtUnixMs !== undefined &&
      (typeof value.createdAtUnixMs !== 'number' || !Number.isFinite(value.createdAtUnixMs)))
  ) {
    throw new Error('A browser workspace entry is invalid.');
  }
  const objects = value.objects ?? [];
  const warnings = value.warnings ?? [];
  if (!Array.isArray(objects) || !objects.every(isObjectSummary)) {
    throw new Error('A browser workspace object list is invalid.');
  }
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === 'string')) {
    throw new Error('A browser workspace warning list is invalid.');
  }
  const legacyPathPrefix = `localstorage://${['Veri', 'dimensio'].join('')}/`;
  return {
    canvasDocument: normalizeWorkspaceCanvasDocument(value.canvasDocument),
    createdAtUnixMs: value.createdAtUnixMs ?? 0,
    id: value.id,
    name: value.name,
    objects: objects.map(normalizeObjectSummary),
    path: value.path.startsWith(legacyPathPrefix)
      ? `localstorage://Kaordo/${value.path.slice(legacyPathPrefix.length)}`
      : value.path,
    warning: value.warning,
    warnings: [...warnings],
  };
}

function isObjectSummary(value: unknown): value is ObjectSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.type === 'string' &&
    (value.document === undefined ||
      (isRecord(value.document) && value.document.version === 1)) &&
    (value.warning === undefined || typeof value.warning === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeWorkspaceName(requestedName: string): string {
  if (requestedName.trim() !== requestedName) {
    throw new Error('Workspace names cannot start or end with whitespace.');
  }
  let name = requestedName;
  while (name.toLowerCase().endsWith('.vdw')) name = name.slice(0, -4);
  if (!name) throw new Error('Enter a workspace name.');
  if (name === '.' || name === '..') {
    throw new Error('Choose a workspace name without path components.');
  }
  if (name.endsWith('.')) throw new Error('Workspace names cannot end with a period.');
  if (new TextEncoder().encode(name).byteLength > MAX_NAME_BYTES) {
    throw new Error(`Workspace names must be ${MAX_NAME_BYTES} bytes or fewer.`);
  }
  if (
    [...name].some(
      (character) =>
        /[\u0000-\u001f\u007f-\u009f]/u.test(character) ||
        /[/\\<>:"|?*]/u.test(character),
    )
  ) {
    throw new Error(
      'Workspace names cannot contain path separators or reserved filename characters.',
    );
  }
  const portableStem = name.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(portableStem)) {
    throw new Error('Choose a workspace name that is portable across operating systems.');
  }
  return name;
}

function normalizeObjectTitle(requestedTitle: string): string {
  const title = requestedTitle.trim();
  if (!title) throw new Error('Enter an object title.');
  if (new TextEncoder().encode(title).byteLength > MAX_OBJECT_TITLE_BYTES) {
    throw new Error(`Object titles must be ${MAX_OBJECT_TITLE_BYTES} bytes or fewer.`);
  }
  if (
    [...title].some((character) =>
      /[\u0000-\u001f\u007f-\u009f]/u.test(character),
    )
  ) {
    throw new Error('Object titles cannot contain control characters.');
  }
  return title;
}

function createUuidV7(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
