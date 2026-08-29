import { tick } from 'svelte';
import type { CanvasPlacement } from '../domain/canvas';
import type {
  ArrowHeadMode,
  ArrowLineStyle,
  CanvasElement,
  MediaElement,
  ObjectDocument,
  ObjectSummary,
  RectangleElement,
  TextElement,
  WorkspaceCanvasDocument,
  WorkspaceDetail,
} from '../domain/workspace';
import {
  canvasElementIdsForObject,
  copyObjectDocument,
  sanitizeTextHtml,
  serializeObjectDocument,
  serializeWorkspaceCanvasDocument,
} from '../domain/workspace';
import {
  CANVAS_CARD_MIN_HEIGHT,
  CANVAS_CARD_MIN_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  canvasApplicationScale,
} from '../features/canvas';
import {
  canvasMediaFrame,
  canvasMediaKind,
  canvasMediaMimeType,
} from '../features/canvasMedia';
import { arrowPoints } from '../features/arrowGeometry';
import { CanvasGState } from '../states/CanvasGState';
import { CanvasDragService } from './CanvasDragService';
import { CanvasViewportService } from './CanvasViewportService';

/** Stable component-facing facade for canvas state and DOM interactions. */
export class CanvasService {
  readonly #deleteObject: (
    workspaceId: string,
    objectId: string,
  ) => Promise<boolean>;
  readonly #deleteCanvasMedia: (
    workspaceId: string,
    mediaId: string,
  ) => Promise<void>;
  readonly #drag: CanvasDragService;
  readonly #getWorkspace: () => WorkspaceDetail | null;
  readonly #loadCanvasDocument: (
    workspaceId: string,
  ) => Promise<WorkspaceCanvasDocument>;
  readonly #loadCanvasMedia: (
    workspaceId: string,
    mediaId: string,
  ) => Promise<Blob | null>;
  readonly #saveCanvasDocument: (
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ) => Promise<void>;
  readonly #saveCanvasMedia: (
    workspaceId: string,
    mediaId: string,
    blob: Blob,
  ) => Promise<void>;
  readonly #updateObjectDocument: (
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ) => Promise<ObjectSummary>;
  readonly #viewport: CanvasViewportService;
  readonly state: CanvasGState;
  readonly #canvasSaves = new Map<string, Promise<void>>();
  readonly #objectSaves = new Map<string, Promise<ObjectSummary>>();
  readonly #pendingPlacements = new Map<string, CanvasPlacement>();
  readonly #persistedCanvasDocuments = new Map<
    string,
    WorkspaceCanvasDocument
  >();
  readonly #history = new Map<string, CanvasHistoryState>();
  readonly #historyCheckpointWorkspaces = new Set<string>();
  readonly #historyOperations = new Map<string, Promise<boolean>>();
  #canvasLoadToken = 0;
  #replayingHistory = false;
  #resize: ObjectResizeGesture | null = null;
  readonly #textEditors = new Map<string, TextEditorController>();
  readonly #mediaBlobs = new Map<string, Blob>();
  readonly #mediaLoads = new Map<string, Promise<Blob | null>>();
  #mediaBlobBytes = 0;

  constructor(
    state: CanvasGState,
    getWorkspace: () => WorkspaceDetail | null,
    updateObjectDocument: (
      workspaceId: string,
      objectId: string,
      document: ObjectDocument,
    ) => Promise<ObjectSummary> = async () => {
      throw new Error('Panel editing is unavailable.');
    },
    loadCanvasDocument: (
      workspaceId: string,
    ) => Promise<WorkspaceCanvasDocument> = async () => ({
      elements: [],
      placements: [],
      version: 1,
    }),
    saveCanvasDocument: (
      workspaceId: string,
      document: WorkspaceCanvasDocument,
    ) => Promise<void> = async () => undefined,
    deleteObject: (
      workspaceId: string,
      objectId: string,
    ) => Promise<boolean> = async () => false,
    saveCanvasMedia: (
      _workspaceId: string,
      _mediaId: string,
      _blob: Blob,
    ) => Promise<void> = async () => undefined,
    loadCanvasMedia: (
      _workspaceId: string,
      _mediaId: string,
    ) => Promise<Blob | null> = async () => null,
    deleteCanvasMedia: (
      _workspaceId: string,
      _mediaId: string,
    ) => Promise<void> = async () => undefined,
  ) {
    this.state = state;
    this.#getWorkspace = getWorkspace;
    this.#updateObjectDocument = updateObjectDocument;
    this.#loadCanvasDocument = loadCanvasDocument;
    this.#saveCanvasDocument = saveCanvasDocument;
    this.#deleteObject = deleteObject;
    this.#saveCanvasMedia = saveCanvasMedia;
    this.#loadCanvasMedia = loadCanvasMedia;
    this.#deleteCanvasMedia = deleteCanvasMedia;
    this.#viewport = new CanvasViewportService(state, getWorkspace);
    this.#drag = new CanvasDragService(
      state,
      getWorkspace,
      this.#viewport,
      (placement) => this.persistPlacement(placement),
    );
  }

  async saveWorkspaceCanvasDocument(
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ): Promise<void> {
    const currentDocument = this.state.canvasDocumentFor(workspaceId);
    const persistedDocument = this.#persistedCanvasDocuments.get(workspaceId);
    if (
      !this.#canvasSaves.has(workspaceId) &&
      persistedDocument &&
      sameCanvasDocument(persistedDocument, document)
    ) return;
    if (!sameCanvasDocument(currentDocument, document)) {
      this.recordHistoryBeforeChange(workspaceId);
    }
    this.state.setCanvasDocument(workspaceId, document);
    const previous = this.#canvasSaves.get(workspaceId);
    const operation = (previous?.catch(() => undefined) ?? Promise.resolve())
      .then(() => this.#saveCanvasDocument(workspaceId, document))
      .then(() => {
        this.#persistedCanvasDocuments.set(workspaceId, copyCanvasDocument(document));
      });
    this.#canvasSaves.set(workspaceId, operation);
    try {
      await operation;
    } catch (error) {
      if (
        this.#canvasSaves.get(workspaceId) === operation &&
        this.state.canvasDocumentFor(workspaceId) === document
      ) {
        this.state.setCanvasDocument(
          workspaceId,
          this.#persistedCanvasDocuments.get(workspaceId) ?? {
            elements: [],
            placements: [],
            version: 1,
          },
        );
      }
      throw error;
    } finally {
      if (this.#canvasSaves.get(workspaceId) === operation) {
        this.#canvasSaves.delete(workspaceId);
      }
    }
  }

  async saveObjectDocument(
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ): Promise<void> {
    const current = this.#getWorkspace();
    const currentObject = current?.id === workspaceId
      ? current.objects.find((object) => object.id === objectId)
      : undefined;
    if (
      currentObject &&
      sameObjectDocument(currentObject.document, document)
    ) {
      return;
    }
    if (
      currentObject &&
      !sameObjectDocument(currentObject.document, document)
    ) {
      this.recordHistoryBeforeChange(workspaceId);
    }
    const key = `${workspaceId}:${objectId}`;
    const previous = this.#objectSaves.get(key);
    const operation = (previous?.catch(() => undefined) ?? Promise.resolve())
      .then(() => this.#updateObjectDocument(workspaceId, objectId, document));
    this.#objectSaves.set(key, operation);
    try {
      const updated = await operation;
      this.state.updateObject(workspaceId, updated);
    } finally {
      if (this.#objectSaves.get(key) === operation) this.#objectSaves.delete(key);
    }
  }

  async deleteWorkspaceObject(
    workspaceId: string,
    objectId: string,
  ): Promise<boolean> {
    await this.#objectSaves.get(`${workspaceId}:${objectId}`)?.catch(() => undefined);
    return this.#deleteObject(workspaceId, objectId);
  }

  async settleWorkspaceWrites(workspaceId: string): Promise<void> {
    const writes: Promise<unknown>[] = [];
    const canvasWrite = this.#canvasSaves.get(workspaceId);
    if (canvasWrite) writes.push(canvasWrite);
    for (const [key, write] of this.#objectSaves) {
      if (key.startsWith(`${workspaceId}:`)) writes.push(write);
    }
    await Promise.allSettled(writes);
  }

  forgetWorkspace(workspaceId: string): void {
    this.#persistedCanvasDocuments.delete(workspaceId);
    this.#history.delete(workspaceId);
    this.#historyCheckpointWorkspaces.delete(workspaceId);
    this.#historyOperations.delete(workspaceId);
    for (const key of this.#pendingPlacements.keys()) {
      if (key.startsWith(`${workspaceId}:`)) this.#pendingPlacements.delete(key);
    }
    for (const key of this.#mediaBlobs.keys()) {
      if (key.startsWith(`${workspaceId}:`)) this.forgetMediaBlob(key);
    }
    for (const key of this.#mediaLoads.keys()) {
      if (key.startsWith(`${workspaceId}:`)) this.#mediaLoads.delete(key);
    }
    this.state.forgetWorkspace(workspaceId);
  }

  async removeObjectReferences(
    workspaceId: string,
    objectId: string,
  ): Promise<void> {
    const document = this.state.canvasDocumentFor(workspaceId);
    const removedElementIds = canvasElementIdsForObject(document, objectId);
    const mediaIds = [...new Set(
      document.elements
        .filter((element): element is MediaElement =>
          element.type === 'media' && removedElementIds.has(element.id),
        )
        .map((element) => element.mediaId),
    )];
    this.state.removeObject(workspaceId, objectId);
    await this.saveWorkspaceCanvasDocument(
      workspaceId,
      this.state.canvasDocumentFor(workspaceId),
    );
    await Promise.allSettled(mediaIds.map((mediaId) => this.#deleteCanvasMedia(workspaceId, mediaId)));
    for (const mediaId of mediaIds) {
      const key = mediaKey(workspaceId, mediaId);
      this.forgetMediaBlob(key);
      this.#mediaLoads.delete(key);
    }
  }

  async deleteCanvasElement(
    workspaceId: string,
    elementId: string,
  ): Promise<void> {
    const document = this.state.canvasDocumentFor(workspaceId);
    const target = document.elements.find((element) => element.id === elementId);
    if (!target) return;
    this.recordHistoryBeforeChange(workspaceId);
    this.state.removeCanvasElement(workspaceId, elementId);
    await this.saveWorkspaceCanvasDocument(
      workspaceId,
      this.state.canvasDocumentFor(workspaceId),
    );
    if (target.type === 'media') {
      await this.#deleteCanvasMedia(workspaceId, target.mediaId).catch(() => undefined);
      this.forgetMediaBlob(mediaKey(workspaceId, target.mediaId));
      this.#mediaLoads.delete(mediaKey(workspaceId, target.mediaId));
    }
    this.state.announce('Element deleted.');
  }

  selectedCanvasElement(): CanvasElement | null {
    const workspace = this.#getWorkspace();
    const id = this.state.snapshot.selectedGlobalElementId;
    if (!workspace || !id) return null;
    return this.state.canvasDocumentFor(workspace.id).elements
      .find((element) => element.id === id) ?? null;
  }

  currentZoom(): number {
    return this.state.zoomFor(this.#getWorkspace()?.id ?? '');
  }

  currentWorkspaceId(): string {
    return this.#getWorkspace()?.id ?? '';
  }

  async addCanvasMediaFiles(
    workspaceId: string,
    files: readonly File[],
    dimensions: readonly ({ height: number; width: number } | undefined)[] = [],
  ): Promise<number> {
    const document = this.state.canvasDocumentFor(workspaceId);
    const pending: PendingCanvasMedia[] = [];
    let nextDocument = document;

    // Build the complete document first. Persisting one canvas snapshot avoids
    // a full Svelte tree update for every selected file (and keeps object
    // placement deterministic when several files are added together).
    for (const [index, file] of files.entries()) {
      const kind = canvasMediaKind(file);
      if (!kind) continue;
      const mediaId = createMediaId();
      const frame = canvasMediaFrame(kind, dimensions[index]?.width, dimensions[index]?.height);
      const position = this.mediaPosition(workspaceId, frame, nextDocument);
      const element: MediaElement = {
        ...position,
        height: frame.height,
        id: mediaId,
        kind,
        mediaId,
        mimeType: canvasMediaMimeType(file, kind),
        name: file.name.slice(0, 240) || 'Untitled media',
        size: file.size,
        type: 'media',
        width: frame.width,
      };
      pending.push({ element, file });
      nextDocument = {
        ...nextDocument,
        elements: [...nextDocument.elements, element],
      };
    }

    const added = pending.length;
    this.state.setTool('select');
    if (!added && files.length) this.state.announce('The selected media format is not supported.');
    if (!added) return 0;

    try {
      // File writes are independent (each media item has its own id), so let
      // the platform perform them concurrently instead of blocking the UI on
      // one file at a time.
      await Promise.all(pending.map(async ({ element, file }) => {
        await this.#saveCanvasMedia(workspaceId, element.mediaId, file);
        this.cacheMediaBlob(mediaKey(workspaceId, element.mediaId), file);
      }));
      // Another interaction may have committed while the platform was
      // writing a large file. Merge into the latest snapshot instead of
      // replacing a concurrently created text/card element.
      const currentDocument = this.state.canvasDocumentFor(workspaceId);
      const existingIds = new Set(currentDocument.elements.map((element) => element.id));
      await this.saveWorkspaceCanvasDocument(workspaceId, {
        ...currentDocument,
        elements: [
          ...currentDocument.elements,
          ...nextDocument.elements.filter((element) => !existingIds.has(element.id)),
        ],
      });
    } catch (error) {
      await Promise.allSettled(
        pending.map(({ element }) => this.#deleteCanvasMedia(workspaceId, element.mediaId)),
      );
      for (const { element } of pending) {
        this.forgetMediaBlob(mediaKey(workspaceId, element.mediaId));
      }
      throw error;
    }

    const last = pending.at(-1)?.element;
    if (last) this.state.selectGlobalElement(last.id);
    this.state.announce(
      added === 1
        ? `${last?.name ?? 'Media'} added to the canvas.`
        : `${added} media items added to the canvas.`,
    );
    return added;
  }

  async loadCanvasMedia(
    workspaceId: string,
    element: Pick<MediaElement, 'mediaId' | 'mimeType'>,
  ): Promise<Blob | null> {
    const key = mediaKey(workspaceId, element.mediaId);
    const cached = this.cachedMediaBlob(key);
    if (cached) return cached;
    const activeLoad = this.#mediaLoads.get(key);
    if (activeLoad) return activeLoad;

    const load = this.#loadCanvasMedia(workspaceId, element.mediaId).then((loaded) => {
      if (!loaded) return null;
      return loaded.type === element.mimeType
        ? loaded
        : loaded.slice(0, loaded.size, element.mimeType);
    });
    this.#mediaLoads.set(key, load);
    try {
      const blob = await load;
      // A deletion/workspace reset can remove the in-flight entry while the
      // platform read is still pending. Do not repopulate a cache that was
      // explicitly invalidated in that case.
      if (this.#mediaLoads.get(key) === load && blob) this.cacheMediaBlob(key, blob);
      return blob;
    } finally {
      if (this.#mediaLoads.get(key) === load) this.#mediaLoads.delete(key);
    }
  }

  private cachedMediaBlob(key: string): Blob | undefined {
    const blob = this.#mediaBlobs.get(key);
    if (!blob) return undefined;
    // Map insertion order is used as a tiny LRU, keeping recently visible
    // media warm while allowing large canvases to release old video blobs.
    this.#mediaBlobs.delete(key);
    this.#mediaBlobs.set(key, blob);
    return blob;
  }

  private cacheMediaBlob(key: string, blob: Blob): void {
    this.forgetMediaBlob(key);
    this.#mediaBlobs.set(key, blob);
    this.#mediaBlobBytes += blob.size;
    while (this.#mediaBlobBytes > MAX_MEDIA_MEMORY_BYTES) {
      const oldest = this.#mediaBlobs.keys().next().value as string | undefined;
      if (!oldest) break;
      this.forgetMediaBlob(oldest);
    }
  }

  private forgetMediaBlob(key: string): void {
    const blob = this.#mediaBlobs.get(key);
    if (!blob) return;
    this.#mediaBlobs.delete(key);
    this.#mediaBlobBytes = Math.max(0, this.#mediaBlobBytes - blob.size);
  }

  private mediaPosition(
    workspaceId: string,
    frame: { height: number; width: number },
    sourceDocument = this.state.canvasDocumentFor(workspaceId),
  ): {
    parentElementId?: string;
    parentObjectId?: string;
    x: number;
    y: number;
  } {
    const selected = this.selectedCanvasElement();
    let parentElementId: string | undefined;
    let parentObjectId: string | undefined;
    let originX = 0;
    let originY = 0;
    let boundsWidth = CANVAS_WIDTH;
    let boundsHeight = CANVAS_HEIGHT;
    let minX = 0;
    let minY = 0;
    if (selected?.type === 'rectangle') {
      parentElementId = selected.id;
      parentObjectId = selected.parentObjectId;
      originX = selected.x + 14;
      originY = selected.y + 14;
      boundsWidth = selected.width;
      boundsHeight = selected.height;
      minX = selected.x + 14;
      minY = selected.y + 14;
    } else if (selected?.type === 'text' || selected?.type === 'media') {
      parentElementId = selected.parentElementId;
      parentObjectId = selected.parentObjectId;
      originX = selected.x + 18;
      originY = selected.y + selected.height + 14;
      const parent = parentElementId
        ? sourceDocument.elements.find((element) => element.id === parentElementId)
        : undefined;
      if (parent?.type === 'rectangle') {
        originX = selected.x + 14;
        originY = selected.y + selected.height + 14;
        boundsWidth = parent.width;
        boundsHeight = parent.height;
        minX = parent.x + 14;
        minY = parent.y + 14;
      }
    } else if (this.state.snapshot.selectedCardId) {
      parentObjectId = this.state.snapshot.selectedCardId;
      const placement = this.state.placementsFor(workspaceId)
        .find((candidate) => candidate.id === parentObjectId);
      if (placement) {
        boundsWidth = placement.width;
        boundsHeight = placement.height - 48;
        originX = Math.max(14, boundsWidth / 2 - frame.width / 2);
        originY = Math.max(14, boundsHeight / 2 - frame.height / 2);
        minX = 14;
        minY = 14;
      }
    } else {
      const metrics = this.#viewport.metrics();
      originX = metrics.scrollLeft + Math.max(0, metrics.width / 2 - frame.width / 2);
      originY = metrics.scrollTop + Math.max(0, metrics.height / 2 - frame.height / 2);
    }
    const siblings = sourceDocument.elements.filter((element) =>
      (element.type === 'text' || element.type === 'media') &&
      element.parentElementId === parentElementId &&
      element.parentObjectId === parentObjectId,
    );
    const offset = siblings.length * 18;
    const maxX = Math.max(minX, minX + boundsWidth - frame.width - 28);
    const maxY = Math.max(minY, minY + boundsHeight - frame.height - 28);
    return {
      ...(parentElementId ? { parentElementId } : {}),
      ...(parentObjectId ? { parentObjectId } : {}),
      x: clamp(originX + offset, minX, maxX),
      y: clamp(originY + offset, minY, maxY),
    };
  }

  /** Handles the editor's platform-aware Undo/Redo shortcuts. */
  handleHistoryKeydown(event: KeyboardEvent): boolean {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      (!event.ctrlKey && !event.metaKey) ||
      event.altKey ||
      isEditableTarget(event.target)
    ) {
      return false;
    }

    const key = event.key.toLowerCase();
    const isUndo = key === 'z' && !event.shiftKey;
    const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
    if (!isUndo && !isRedo) return false;

    const workspaceId = this.currentWorkspaceId();
    if (!workspaceId) return false;
    event.preventDefault();
    event.stopPropagation();
    void (isUndo ? this.undo() : this.redo());
    return true;
  }

  undo(): Promise<boolean> {
    const workspaceId = this.currentWorkspaceId();
    return workspaceId
      ? this.queueHistoryOperation(workspaceId, () => this.applyUndo(workspaceId))
      : Promise.resolve(false);
  }

  redo(): Promise<boolean> {
    const workspaceId = this.currentWorkspaceId();
    return workspaceId
      ? this.queueHistoryOperation(workspaceId, () => this.applyRedo(workspaceId))
      : Promise.resolve(false);
  }

  createTextElement(
    workspaceId: string,
    position: {
      parentElementId?: string;
      parentObjectId?: string;
      width?: number;
      x: number;
      y: number;
    },
  ): TextElement {
    const element: TextElement = {
      color: '#25332d',
      fontSize: 16,
      height: 48,
      html: '',
      id: createCanvasElementId('text'),
      textAlign: 'left',
      type: 'text',
      width: position.width ?? 260,
      x: position.x,
      y: position.y,
    };
    if (position.parentObjectId) {
      element.parentObjectId = position.parentObjectId;
    }
    if (position.parentElementId) {
      element.parentElementId = position.parentElementId;
    }
    const document = this.state.canvasDocumentFor(workspaceId);
    void this.saveWorkspaceCanvasDocument(workspaceId, {
      ...document,
      elements: [...document.elements, element],
    }).catch(() => this.state.announce('Text could not be created.'));
    this.state.editText(element.id);
    this.state.announce('Text added. Start typing.');
    return element;
  }

  editRectangleText(
    workspaceId: string,
    rectangle: RectangleElement,
  ): TextElement {
    const document = this.state.canvasDocumentFor(workspaceId);
    const existing = document.elements.find(
      (element): element is TextElement =>
        element.type === 'text' && element.parentElementId === rectangle.id,
    );
    if (existing) {
      this.state.editText(existing.id);
      this.state.announce('Text editor opened.');
      return existing;
    }

    const padding = 12;
    const width = Math.max(32, Math.min(260, rectangle.width - padding * 2));
    const height = 48;
    return this.createTextElement(workspaceId, {
      parentElementId: rectangle.id,
      parentObjectId: rectangle.parentObjectId,
      width,
      x: clamp(rectangle.x + padding, rectangle.x, rectangle.x + rectangle.width - width),
      y: clamp(rectangle.y + padding, rectangle.y, rectangle.y + rectangle.height - height),
    });
  }

  async updateCanvasElement(
    workspaceId: string,
    updated: CanvasElement,
  ): Promise<void> {
    const document = this.state.canvasDocumentFor(workspaceId);
    await this.saveWorkspaceCanvasDocument(workspaceId, {
      ...document,
      elements: document.elements.map((element) =>
        element.id === updated.id ? updated : element,
      ),
    });
  }

  async resizeCanvasCard(
    workspaceId: string,
    rectangle: RectangleElement,
    size: { height: number; width: number },
  ): Promise<void> {
    const document = this.state.canvasDocumentFor(workspaceId);
    const current = document.elements.find(
      (element): element is RectangleElement =>
        element.id === rectangle.id && element.type === 'rectangle',
    );
    if (!current) return;

    const resized = { ...current, ...size };
    await this.saveWorkspaceCanvasDocument(workspaceId, {
      ...document,
      elements: document.elements.map((element) => {
        if (element.id === resized.id) return resized;
        if (
          (element.type !== 'text' && element.type !== 'media') ||
          element.parentElementId !== resized.id
        ) {
          return element;
        }
        const width = Math.min(
          element.width,
          Math.max(32, resized.width),
        );
        return {
          ...element,
          width,
          x: clamp(
            element.x,
            resized.x,
            resized.x + resized.width - width,
          ),
          y: clamp(
            element.y,
            resized.y,
            resized.y + resized.height - element.height,
          ),
        };
      }),
    });
  }

  attachTextEditor(
    elementId: string,
    editor: TextEditorController | null,
  ): void {
    if (editor) this.#textEditors.set(elementId, editor);
    else this.#textEditors.delete(elementId);
  }

  async formatSelectedText(command: TextFormatCommand, value?: string): Promise<void> {
    const selected = this.selectedCanvasElement();
    if (selected?.type !== 'text') return;
    if (this.state.snapshot.editingTextId !== selected.id) {
      this.state.editText(selected.id);
      await tick();
    }
    this.#textEditors.get(selected.id)?.format(command, value);
  }

  async setTextFontSize(fontSize: number): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'text') return;
    await this.updateCanvasElement(workspace.id, { ...selected, fontSize });
  }

  async setTextAlignment(textAlign: TextElement['textAlign']): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'text') return;
    await this.updateCanvasElement(workspace.id, { ...selected, textAlign });
  }

  async setTextLeftBars(leftBars: TextElement['leftBars'] | null): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'text') return;
    const updated = { ...selected };
    if (leftBars === null || leftBars === undefined) delete updated.leftBars;
    else updated.leftBars = leftBars;
    await this.updateCanvasElement(workspace.id, updated);
  }

  async focusTextElement(workspaceId: string, elementId: string): Promise<void> {
    await this.focusCanvasElement(workspaceId, elementId);
  }

  async focusCanvasElement(workspaceId: string, elementId: string): Promise<void> {
    this.state.selectGlobalElement(elementId);
    await this.#viewport.focusCanvasElement(workspaceId, elementId);
  }

  async setRectangleFill(color: string): Promise<void> {
    this.state.setShapeFill(color);
    await this.updateSelectedRectangle({ fill: color });
  }

  async setRectangleStroke(color: string): Promise<void> {
    this.state.setShapeStroke(color);
    await this.updateSelectedRectangle({ stroke: color });
  }

  async setArrowStroke(color: string): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'arrow') return;
    await this.updateCanvasElement(workspace.id, { ...selected, stroke: color });
  }

  async setArrowWidth(strokeWidth: number): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'arrow') return;
    await this.updateCanvasElement(workspace.id, {
      ...selected,
      strokeWidth: clamp(strokeWidth, 1, 12),
    });
  }

  async setArrowHeadMode(headMode: ArrowHeadMode): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'arrow') return;
    await this.updateCanvasElement(workspace.id, { ...selected, headMode });
  }

  async setArrowLineStyle(lineStyle: ArrowLineStyle): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'arrow') return;
    await this.updateCanvasElement(workspace.id, { ...selected, lineStyle });
  }

  async addArrowControlPoint(): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'arrow') return;
    if (selected.controlPoints.length >= 32) return;
    const document = this.state.canvasDocumentFor(workspace.id);
    const placements = this.state.placementsFor(workspace.id);
    const resolved = arrowPoints(selected, document.elements, placements);
    const anchors = [resolved.start, ...selected.controlPoints, resolved.end];
    let segmentIndex = 0;
    let longestSegment = -1;
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const length = Math.hypot(
        anchors[index + 1].x - anchors[index].x,
        anchors[index + 1].y - anchors[index].y,
      );
      if (length > longestSegment) {
        longestSegment = length;
        segmentIndex = index;
      }
    }
    const first = anchors[segmentIndex];
    const second = anchors[segmentIndex + 1];
    const controlPoints = [...selected.controlPoints];
    controlPoints.splice(segmentIndex, 0, {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    });
    await this.updateCanvasElement(workspace.id, {
      ...selected,
      controlPoints,
    });
  }

  async removeArrowControlPoint(): Promise<void> {
    const selected = this.selectedCanvasElement();
    const workspace = this.#getWorkspace();
    if (!workspace || selected?.type !== 'arrow' || selected.controlPoints.length <= 1) return;
    await this.updateCanvasElement(workspace.id, {
      ...selected,
      controlPoints: selected.controlPoints.slice(0, -1),
    });
  }

  startObjectResize(event: PointerEvent, placement: CanvasPlacement): void {
    if (event.button !== 0 || this.#resize) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const positioner = handle.closest<HTMLElement>('.canvas-card-positioner');
    if (!positioner) return;
    this.state.clearEntering(
      this.#getWorkspace()?.id ?? '',
      placement.id,
    );
    positioner.style.willChange = 'width, height';
    handle.setPointerCapture?.(event.pointerId);
    this.#resize = {
      handle,
      height: placement.height,
      object: placement,
      pointerId: event.pointerId,
      positioner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      width: placement.width,
    };
    this.state.setResizingObject(placement.id);
  }

  continueObjectResize(event: PointerEvent): void {
    const resize = this.#resize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.applyResizeVisual(resize, latestPointerSample(event));
  }

  finishObjectResize(event: PointerEvent): void {
    const resize = this.#resize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const size = this.applyResizeVisual(resize, latestPointerSample(event), true);
    this.#resize = null;
    resize.positioner.style.removeProperty('will-change');
    this.releaseResizePointer(resize);
    this.state.setResizingObject(null);
    const workspace = this.#getWorkspace();
    if (!workspace) return;
    this.state.resizeObject(workspace.id, resize.object.id, size);
    this.persistPlacement({ ...resize.object, ...size });
    void this.saveObjectDocument(workspace.id, resize.object.id, {
      ...resize.object.document,
      frame: size,
    }).catch(() => this.state.announce('Panel size could not be saved.'));
  }

  cancelObjectResize(event: PointerEvent): void {
    const resize = this.#resize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.stopPropagation();
    this.cancelResize(resize);
  }

  handleObjectResizeCaptureLost(event: PointerEvent): void {
    const resize = this.#resize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    this.cancelResize(resize, false);
  }

  handleObjectResizeKeydown(
    event: KeyboardEvent,
    placement: CanvasPlacement,
  ): void {
    const step = event.shiftKey ? 80 : 16;
    let width = placement.width;
    let height = placement.height;
    if (event.key === 'ArrowLeft') width -= step;
    else if (event.key === 'ArrowRight') width += step;
    else if (event.key === 'ArrowUp') height -= step;
    else if (event.key === 'ArrowDown') height += step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const size = constrainObjectSize(placement, { height, width });
    const workspace = this.#getWorkspace();
    if (!workspace) return;
    this.state.resizeObject(workspace.id, placement.id, size);
    this.persistPlacement({ ...placement, ...size });
    void this.saveObjectDocument(workspace.id, placement.id, {
      ...placement.document,
      frame: size,
    }).catch(() => this.state.announce('Panel size could not be saved.'));
  }

  attachViewport(element: HTMLDivElement | null): void {
    this.#viewport.attach(element);
  }

  attachFloatingCard(element: HTMLElement | null): void {
    this.#drag.attachFloatingCard(element);
  }

  enterWorkspace(workspace: WorkspaceDetail): void {
    this.#viewport.invalidateCameraRestore();
    this.#history.delete(workspace.id);
    this.#historyCheckpointWorkspaces.delete(workspace.id);
    this.state.prepareWorkspace(workspace);
    const token = ++this.#canvasLoadToken;
    void this.#loadCanvasDocument(workspace.id)
      .then((loadedDocument) => {
        if (
          token === this.#canvasLoadToken &&
          this.#getWorkspace()?.id === workspace.id
        ) {
          const document = this.prepareCanvasDocument(
            workspace,
            loadedDocument,
          );
          this.state.setCanvasDocument(workspace.id, document);
          this.state.restorePlacements(workspace, document);
          this.#persistedCanvasDocuments.set(workspace.id, copyCanvasDocument(loadedDocument));
          this.state.markCanvasDocumentReady();
          for (const key of this.#pendingPlacements.keys()) {
            if (key.startsWith(`${workspace.id}:`)) {
              this.#pendingPlacements.delete(key);
            }
          }
          if (document !== loadedDocument) {
            void this.saveWorkspaceCanvasDocument(workspace.id, document)
              .catch(() => this.state.announce('Canvas migration could not be saved.'));
          }
        }
      })
      .catch(() => {
        if (token === this.#canvasLoadToken) {
          this.state.setCanvasDocument(workspace.id, {
            elements: [],
            placements: [],
            version: 1,
          });
          this.state.markCanvasDocumentReady();
          this.state.announce('Canvas elements could not be loaded.');
        }
      });
    void this.#viewport.restoreCamera(workspace.id);
  }

  leaveWorkspace(workspaceId = this.#getWorkspace()?.id): void {
    this.#canvasLoadToken += 1;
    if (workspaceId) this.#viewport.captureCamera(workspaceId);
    this.clearInteractions();
    this.#viewport.invalidateCameraRestore();
    this.state.leaveWorkspace();
  }

  isObjectPlaced(workspaceId: string, objectId: string): boolean {
    return this.state
      .placementsFor(workspaceId)
      .some((placement) => placement.id === objectId);
  }

  handleObjectSourceClick(object: ObjectSummary): void {
    this.#drag.handleObjectSourceClick(object);
  }

  handleObjectSourceKeydown(event: KeyboardEvent, object: ObjectSummary): void {
    this.#drag.handleObjectSourceKeydown(event, object);
  }

  startObjectPointerDrag(event: PointerEvent, object: ObjectSummary): void {
    this.#drag.start(
      event,
      object,
      this.state.snapshot.isPanning || this.#resize !== null,
    );
  }

  continueObjectPointerDrag(event: PointerEvent): void {
    this.#drag.continue(event);
  }

  finishObjectPointerDrag(event: PointerEvent): void {
    this.#drag.finish(event);
  }

  cancelObjectPointerDrag(event: PointerEvent): void {
    this.#drag.cancel(event);
  }

  handleObjectPointerCaptureLost(event: PointerEvent): void {
    this.#drag.handleCaptureLost(event);
  }

  placeObjectFromKeyboard(object: ObjectSummary): void {
    this.#drag.placeObjectFromKeyboard(object);
  }

  placeObjectAtVisibleCenter(object: ObjectSummary): void {
    this.#drag.placeObjectAtVisibleCenter(object);
  }

  handleCanvasCardKeydown(
    event: KeyboardEvent,
    placement: CanvasPlacement,
  ): void {
    this.#drag.handleCanvasCardKeydown(event, placement);
  }

  handleCanvasScroll(): void {
    this.#drag.handleViewportScroll();
    this.#viewport.scheduleCameraCapture();
  }

  handleCanvasWheel(event: WheelEvent, canPreventDefault = true): boolean {
    return this.#viewport.zoomFromWheel(event, canPreventDefault);
  }

  zoomIn(): void {
    this.#viewport.zoomBy(1.2);
  }

  zoomOut(): void {
    this.#viewport.zoomBy(1 / 1.2);
  }

  resetZoom(): void {
    this.#viewport.resetZoom();
  }

  startCanvasPan(event: PointerEvent): void {
    this.#viewport.startPan(event, this.#drag.isActive);
  }

  continueCanvasPan(event: PointerEvent): void {
    this.#viewport.continuePan(event);
  }

  finishCanvasPan(event: PointerEvent): void {
    this.#viewport.finishPan(event);
  }

  handleCanvasPanCaptureLost(event: PointerEvent): void {
    this.#viewport.handlePanCaptureLost(event);
  }

  captureCamera(workspaceId = this.#getWorkspace()?.id): void {
    this.#viewport.captureCamera(workspaceId);
  }

  restoreCamera(workspaceId: string): Promise<void> {
    return this.#viewport.restoreCamera(workspaceId);
  }

  clearInteractions(): void {
    if (this.#resize) this.cancelResize(this.#resize);
    this.#drag.clear();
    this.#viewport.clearPan();
    this.state.resetInteractions();
  }

  private recordHistoryBeforeChange(workspaceId: string): void {
    if (
      this.#replayingHistory ||
      this.#historyCheckpointWorkspaces.has(workspaceId)
    ) {
      return;
    }
    const history = this.historyFor(workspaceId);
    history.past.push(this.captureHistorySnapshot(workspaceId));
    if (history.past.length > MAX_HISTORY_ENTRIES) history.past.shift();
    history.future = [];
    this.#historyCheckpointWorkspaces.add(workspaceId);
    Promise.resolve().then(() => {
      this.#historyCheckpointWorkspaces.delete(workspaceId);
    });
  }

  private captureHistorySnapshot(workspaceId: string): CanvasHistorySnapshot {
    const workspace = this.#getWorkspace();
    const objectDocuments: Record<string, ObjectDocument> = {};
    if (workspace?.id === workspaceId) {
      for (const object of workspace.objects) {
        objectDocuments[object.id] = copyObjectDocument(object.document);
      }
    }
    return {
      canvasDocument: copyCanvasDocument(
        this.state.canvasDocumentFor(workspaceId),
      ),
      objectDocuments,
    };
  }

  private historyFor(workspaceId: string): CanvasHistoryState {
    const existing = this.#history.get(workspaceId);
    if (existing) return existing;
    const created: CanvasHistoryState = { future: [], past: [] };
    this.#history.set(workspaceId, created);
    return created;
  }

  private queueHistoryOperation(
    workspaceId: string,
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    const previous = this.#historyOperations.get(workspaceId) ??
      Promise.resolve(true);
    const next = previous.catch(() => false).then(operation);
    this.#historyOperations.set(workspaceId, next);
    void next.finally(() => {
      if (this.#historyOperations.get(workspaceId) === next) {
        this.#historyOperations.delete(workspaceId);
      }
    }).catch(() => undefined);
    return next;
  }

  private async applyUndo(workspaceId: string): Promise<boolean> {
    await this.settleWorkspaceWrites(workspaceId);
    const history = this.historyFor(workspaceId);
    const target = history.past.pop();
    if (!target) return false;
    const current = this.captureHistorySnapshot(workspaceId);
    history.future.push(current);
    try {
      await this.applyHistorySnapshot(workspaceId, target);
      this.state.announce('Undid the last canvas change.');
      return true;
    } catch {
      history.future.pop();
      history.past.push(target);
      this.state.announce('The last canvas change could not be undone.');
      return false;
    }
  }

  private async applyRedo(workspaceId: string): Promise<boolean> {
    await this.settleWorkspaceWrites(workspaceId);
    const history = this.historyFor(workspaceId);
    const target = history.future.pop();
    if (!target) return false;
    const current = this.captureHistorySnapshot(workspaceId);
    history.past.push(current);
    try {
      await this.applyHistorySnapshot(workspaceId, target);
      this.state.announce('Redid the last canvas change.');
      return true;
    } catch {
      history.past.pop();
      history.future.push(target);
      this.state.announce('The last canvas change could not be redone.');
      return false;
    }
  }

  private async applyHistorySnapshot(
    workspaceId: string,
    snapshot: CanvasHistorySnapshot,
  ): Promise<void> {
    const workspace = this.#getWorkspace();
    if (!workspace || workspace.id !== workspaceId) {
      throw new Error('The workspace is no longer open.');
    }
    this.#replayingHistory = true;
    try {
      const objectWrites = workspace.objects.flatMap((object) => {
        const target = snapshot.objectDocuments[object.id];
        return target && !sameObjectDocument(object.document, target)
          ? [this.#updateObjectDocument(
              workspaceId,
              object.id,
              copyObjectDocument(target),
            )]
          : [];
      });
      await Promise.all(objectWrites);
      await this.#saveCanvasDocument(
        workspaceId,
        copyCanvasDocument(snapshot.canvasDocument),
      );
      const restored = copyCanvasDocument(snapshot.canvasDocument);
      this.state.setCanvasDocument(workspaceId, restored);
      this.state.restorePlacements(this.#getWorkspace() ?? workspace, restored);
      this.#persistedCanvasDocuments.set(workspaceId, copyCanvasDocument(restored));
    } finally {
      this.#replayingHistory = false;
    }
  }

  private applyResizeVisual(
    resize: ObjectResizeGesture,
    sample: PointerEvent,
    round = false,
  ): { height: number; width: number } {
    const size = constrainObjectSize(resize.object, {
      height:
        resize.height +
          (sample.clientY - resize.startClientY) /
            canvasApplicationScale() /
            this.currentZoom(),
      width:
        resize.width +
          (sample.clientX - resize.startClientX) /
            canvasApplicationScale() /
            this.currentZoom(),
    });
    const committed = round
      ? { height: Math.round(size.height), width: Math.round(size.width) }
      : size;
    resize.positioner.style.width = `${committed.width}px`;
    resize.positioner.style.height = `${committed.height}px`;
    return committed;
  }

  private cancelResize(
    resize: ObjectResizeGesture,
    releasePointer = true,
  ): void {
    this.#resize = null;
    resize.positioner.style.width = `${resize.width}px`;
    resize.positioner.style.height = `${resize.height}px`;
    resize.positioner.style.removeProperty('will-change');
    if (releasePointer) this.releaseResizePointer(resize);
    this.state.setResizingObject(null);
  }

  private releaseResizePointer(resize: ObjectResizeGesture): void {
    if (resize.handle.hasPointerCapture?.(resize.pointerId)) {
      resize.handle.releasePointerCapture(resize.pointerId);
    }
  }

  private async updateSelectedRectangle(
    patch: { fill?: string; stroke?: string },
  ): Promise<void> {
    const workspace = this.#getWorkspace();
    const {
      selectedCardId,
      selectedElementId,
      selectedGlobalElementId,
    } = this.state.snapshot;
    if (workspace && selectedGlobalElementId) {
      const document = this.state.canvasDocumentFor(workspace.id);
      await this.saveWorkspaceCanvasDocument(workspace.id, {
        elements: document.elements.map((element) =>
          element.id === selectedGlobalElementId
            ? { ...element, ...patch }
            : element,
        ),
        placements: document.placements,
        version: 1,
      });
      return;
    }
    if (!workspace || !selectedCardId || !selectedElementId) return;
    const object = workspace.objects.find((candidate) => candidate.id === selectedCardId);
    if (!object) return;
    const elements = object.document.elements.map((element) =>
      element.id === selectedElementId && element.type === 'rectangle'
        ? { ...element, ...patch }
        : element,
    );
    await this.saveObjectDocument(workspace.id, object.id, {
      ...object.document,
      elements,
    });
  }

  private persistPlacement(placement: CanvasPlacement): void {
    const workspace = this.#getWorkspace();
    if (!workspace || workspace.id === '') return;
    if (!this.state.snapshot.isCanvasDocumentReady) {
      this.#pendingPlacements.set(`${workspace.id}:${placement.id}`, placement);
      return;
    }
    const document = this.state.canvasDocumentFor(workspace.id);
    const saved = {
      height: placement.height,
      objectId: placement.id,
      width: placement.width,
      x: placement.x,
      y: placement.y,
    };
    const exists = document.placements.some(
      (candidate) => candidate.objectId === placement.id,
    );
    const placements = exists
      ? document.placements.map((candidate) =>
          candidate.objectId === placement.id ? saved : candidate,
        )
      : [...document.placements, saved];
    void this.saveWorkspaceCanvasDocument(workspace.id, {
      ...document,
      placements,
    }).catch(() => this.state.announce('Panel position could not be saved.'));
  }

  private prepareCanvasDocument(
    workspace: WorkspaceDetail,
    document: WorkspaceCanvasDocument,
  ): WorkspaceCanvasDocument {
    const knownElementIds = new Set(document.elements.map((element) => element.id));
    const migratedElements: CanvasElement[] = [];
    for (const object of workspace.objects) {
      object.document.elements.forEach((element, index) => {
        if (knownElementIds.has(element.id)) return;
        if (element.type === 'rectangle') {
          migratedElements.push({ ...element, parentObjectId: object.id });
        } else {
          migratedElements.push({
            color: '#25332d',
            fontSize: 16,
            height: 56,
            html: sanitizeTextHtml(element.html),
            id: element.id,
            parentObjectId: object.id,
            textAlign: 'left',
            type: 'text',
            width: 260,
            x: 18,
            y: 18 + index * 68,
          });
        }
        knownElementIds.add(element.id);
      });
    }
    const sessionPlacements = this.state.placementsFor(workspace.id);
    const pendingPlacements = [...this.#pendingPlacements.entries()]
      .filter(([key]) => key.startsWith(`${workspace.id}:`))
      .map(([, placement]) => placement);
    if (
      migratedElements.length === 0 &&
      pendingPlacements.length === 0 &&
      (document.placements.length > 0 || sessionPlacements.length === 0)
    ) {
      return document;
    }
    const placements = pendingPlacements.reduce(
      (saved, placement) => {
        const next = {
          height: placement.height,
          objectId: placement.id,
          width: placement.width,
          x: placement.x,
          y: placement.y,
        };
        const exists = saved.some(
          (candidate) => candidate.objectId === placement.id,
        );
        return exists
          ? saved.map((candidate) =>
              candidate.objectId === placement.id ? next : candidate,
            )
          : [...saved, next];
      },
      document.placements.length > 0
        ? document.placements
        : sessionPlacements.map((placement) => ({
            height: placement.height,
            objectId: placement.id,
            width: placement.width,
            x: placement.x,
            y: placement.y,
          })),
    );
    return {
      elements: [...document.elements, ...migratedElements],
      placements,
      version: 1,
    };
  }
}

type ObjectResizeGesture = {
  handle: HTMLElement;
  height: number;
  object: CanvasPlacement;
  pointerId: number;
  positioner: HTMLElement;
  startClientX: number;
  startClientY: number;
  width: number;
};

type PendingCanvasMedia = {
  element: MediaElement;
  file: File;
};

type CanvasHistorySnapshot = {
  canvasDocument: WorkspaceCanvasDocument;
  objectDocuments: Record<string, ObjectDocument>;
};

type CanvasHistoryState = {
  future: CanvasHistorySnapshot[];
  past: CanvasHistorySnapshot[];
};

const MAX_HISTORY_ENTRIES = 100;
const MAX_MEDIA_MEMORY_BYTES = 256 * 1024 * 1024;

export type TextFormatCommand =
  | 'bold'
  | 'foreColor'
  | 'hiliteColor'
  | 'italic'
  | 'strikeThrough'
  | 'underline';

export type TextEditorController = {
  format(command: TextFormatCommand, value?: string): void;
};

function constrainObjectSize(
  placement: Pick<CanvasPlacement, 'x' | 'y'>,
  size: { height: number; width: number },
): { height: number; width: number } {
  return {
    height: clamp(
      size.height,
      CANVAS_CARD_MIN_HEIGHT,
      CANVAS_HEIGHT - placement.y - 40,
    ),
    width: clamp(
      size.width,
      CANVAS_CARD_MIN_WIDTH,
      CANVAS_WIDTH - placement.x - 40,
    ),
  };
}

function latestPointerSample(event: PointerEvent): PointerEvent {
  const samples = event.getCoalescedEvents?.() ?? [];
  return samples.at(-1) ?? event;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}

function createCanvasElementId(kind: string): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMediaId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  if (!bytes.some(Boolean)) {
    const seed = `${Date.now()}${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = seed.charCodeAt(index % seed.length) & 0xff;
    }
  }
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mediaKey(workspaceId: string, mediaId: string): string {
  return `${workspaceId}:${mediaId}`;
}

function copyCanvasDocument(
  document: WorkspaceCanvasDocument,
): WorkspaceCanvasDocument {
  return {
    elements: document.elements.map((element) =>
      element.type === 'arrow'
        ? { ...element, controlPoints: element.controlPoints.map((point) => ({ ...point })) }
        : { ...element },
    ),
    placements: document.placements.map((placement) => ({ ...placement })),
    version: 1,
  };
}

function sameCanvasDocument(
  left: WorkspaceCanvasDocument,
  right: WorkspaceCanvasDocument,
): boolean {
  return serializeWorkspaceCanvasDocument(left) ===
    serializeWorkspaceCanvasDocument(right);
}

function sameObjectDocument(
  left: ObjectDocument,
  right: ObjectDocument,
): boolean {
  return serializeObjectDocument(left) === serializeObjectDocument(right);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT';
}
