import { tick } from 'svelte';
import type { CanvasPlacement } from '../domain/canvas';
import type {
  CanvasElement,
  ObjectDocument,
  ObjectSummary,
  RectangleElement,
  TextElement,
  WorkspaceCanvasDocument,
  WorkspaceDetail,
} from '../domain/workspace';
import {
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
} from '../features/canvas';
import { CanvasGState } from '../states/CanvasGState';
import { CanvasDragService } from './CanvasDragService';
import { CanvasViewportService } from './CanvasViewportService';

/** Stable component-facing facade for canvas state and DOM interactions. */
export class CanvasService {
  readonly #deleteObject: (
    workspaceId: string,
    objectId: string,
  ) => Promise<boolean>;
  readonly #drag: CanvasDragService;
  readonly #getWorkspace: () => WorkspaceDetail | null;
  readonly #loadCanvasDocument: (
    workspaceId: string,
  ) => Promise<WorkspaceCanvasDocument>;
  readonly #saveCanvasDocument: (
    workspaceId: string,
    document: WorkspaceCanvasDocument,
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
  ) {
    this.state = state;
    this.#getWorkspace = getWorkspace;
    this.#updateObjectDocument = updateObjectDocument;
    this.#loadCanvasDocument = loadCanvasDocument;
    this.#saveCanvasDocument = saveCanvasDocument;
    this.#deleteObject = deleteObject;
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
    if (
      !sameCanvasDocument(
        this.state.canvasDocumentFor(workspaceId),
        document,
      )
    ) {
      this.recordHistoryBeforeChange(workspaceId);
    }
    this.state.setCanvasDocument(workspaceId, document);
    const previous = this.#canvasSaves.get(workspaceId);
    const operation = (previous?.catch(() => undefined) ?? Promise.resolve())
      .then(() => this.#saveCanvasDocument(workspaceId, document))
      .then(() => {
        this.#persistedCanvasDocuments.set(workspaceId, document);
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
    this.state.forgetWorkspace(workspaceId);
  }

  async removeObjectReferences(
    workspaceId: string,
    objectId: string,
  ): Promise<void> {
    this.state.removeObject(workspaceId, objectId);
    await this.saveWorkspaceCanvasDocument(
      workspaceId,
      this.state.canvasDocumentFor(workspaceId),
    );
  }

  async deleteCanvasElement(
    workspaceId: string,
    elementId: string,
  ): Promise<void> {
    const document = this.state.canvasDocumentFor(workspaceId);
    if (!document.elements.some((element) => element.id === elementId)) return;
    this.recordHistoryBeforeChange(workspaceId);
    this.state.removeCanvasElement(workspaceId, elementId);
    await this.saveWorkspaceCanvasDocument(
      workspaceId,
      this.state.canvasDocumentFor(workspaceId),
    );
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
          this.#persistedCanvasDocuments.set(workspace.id, loadedDocument);
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

  handleCanvasWheel(event: WheelEvent): void {
    this.#viewport.zoomFromWheel(event);
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
      this.#persistedCanvasDocuments.set(workspaceId, restored);
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
        resize.height + (sample.clientY - resize.startClientY) / this.currentZoom(),
      width:
        resize.width + (sample.clientX - resize.startClientX) / this.currentZoom(),
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

type CanvasHistorySnapshot = {
  canvasDocument: WorkspaceCanvasDocument;
  objectDocuments: Record<string, ObjectDocument>;
};

type CanvasHistoryState = {
  future: CanvasHistorySnapshot[];
  past: CanvasHistorySnapshot[];
};

const MAX_HISTORY_ENTRIES = 100;

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

function copyCanvasDocument(
  document: WorkspaceCanvasDocument,
): WorkspaceCanvasDocument {
  return {
    elements: document.elements.map((element) => ({ ...element })),
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
