import type {
  CanvasCamera,
  CanvasPlacement,
  CanvasPoint,
} from '../domain/canvas';
import type {
  ObjectSummary,
  TextArrowSource,
  WorkspaceCanvasDocument,
  WorkspaceDetail,
} from '../domain/workspace';
import { canvasElementIdsForObject } from '../domain/workspace';
import {
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  CANVAS_DEFAULT_ZOOM,
  clampCanvasZoom,
} from '../features/canvas';
import type {
  CanvasSelection,
  CanvasSelectionOptions,
} from '../features/canvasSelection';
import { selectionKey } from '../features/canvasSelection';
import type { CanvasSearchHighlight } from '../features/canvasSearch';
import { translateAttachedArrowGeometry } from '../features/elementAttachment';
import { GState } from '../state/GState';

export type CanvasSnapshot = {
  activeTool: CanvasTool;
  announcement: string;
  cameras: Record<string, CanvasCamera>;
  canvasDocuments: Record<string, WorkspaceCanvasDocument>;
  draggingObjectId: string | null;
  editingTextId: string | null;
  enteringObjects: Record<string, true>;
  floatingObject: ObjectSummary | null;
  isCameraReady: boolean;
  isCanvasDocumentReady: boolean;
  isDropTarget: boolean;
  isPanning: boolean;
  resizingObjectId: string | null;
  /** Ephemeral visual confirmation for the most recently searched target. */
  searchHighlight: CanvasSearchHighlight | null;
  placements: Record<string, CanvasPlacement[]>;
  /** Explicit panel/element selection; descendants are derived by renderers. */
  selectedItems: CanvasSelection[];
  selectedCardId: string | null;
  selectedElementId: string | null;
  selectedGlobalElementId: string | null;
  shapeFill: string;
  shapeStroke: string;
  textArrowSource: TextArrowSource | null;
  textArrowCursor: CanvasPoint | null;
  zooms: Record<string, number>;
};

export type CanvasTool = 'arrow' | 'rectangle' | 'select' | 'text';

/** Owns serializable canvas-session data and small cross-component UI signals. */
export class CanvasGState extends GState<CanvasSnapshot> {
  readonly #entryTimers = new Map<string, number>();

  constructor() {
    super({
      activeTool: 'select',
      announcement: '',
      cameras: {},
      canvasDocuments: {},
      draggingObjectId: null,
      editingTextId: null,
      enteringObjects: {},
      floatingObject: null,
      isCameraReady: false,
      isCanvasDocumentReady: false,
      isDropTarget: false,
      isPanning: false,
      placements: {},
      resizingObjectId: null,
      searchHighlight: null,
      selectedItems: [],
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
      shapeFill: '#dcece5',
      shapeStroke: '#397565',
      textArrowSource: null,
      textArrowCursor: null,
      zooms: {},
    });
  }

  override exit(): void {
    for (const timer of this.#entryTimers.values()) window.clearTimeout(timer);
    this.#entryTimers.clear();
    this.patch({
      draggingObjectId: null,
      editingTextId: null,
      enteringObjects: {},
      floatingObject: null,
      isCameraReady: false,
      isCanvasDocumentReady: false,
      isDropTarget: false,
      isPanning: false,
      resizingObjectId: null,
      searchHighlight: null,
      selectedItems: [],
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
      textArrowSource: null,
      textArrowCursor: null,
    });
  }

  placementsFor(workspaceId: string): CanvasPlacement[] {
    return this.snapshot.placements[workspaceId] ?? [];
  }

  cameraFor(workspaceId: string): CanvasCamera | undefined {
    return this.snapshot.cameras[workspaceId];
  }

  zoomFor(workspaceId: string): number {
    return this.snapshot.zooms[workspaceId] ?? CANVAS_DEFAULT_ZOOM;
  }

  setZoom(workspaceId: string, zoom: number): number {
    const next = clampCanvasZoom(zoom);
    if (this.zoomFor(workspaceId) !== next) {
      this.patch({ zooms: { ...this.snapshot.zooms, [workspaceId]: next } });
    }
    return next;
  }

  canvasDocumentFor(workspaceId: string): WorkspaceCanvasDocument {
    return this.snapshot.canvasDocuments[workspaceId] ?? {
      elements: [],
      placements: [],
      version: 1,
    };
  }

  setCanvasDocument(
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ): void {
    this.patch({
      canvasDocuments: {
        ...this.snapshot.canvasDocuments,
        [workspaceId]: document,
      },
    });
  }

  restorePlacements(
    workspace: WorkspaceDetail,
    document: WorkspaceCanvasDocument,
  ): void {
    const objects = new Map(
      workspace.objects.map((object) => [object.id, object] as const),
    );
    const placements = document.placements.flatMap((saved) => {
      const object = objects.get(saved.objectId);
      return object
        ? [{
            ...object,
            height: saved.height,
            width: saved.width,
            x: saved.x,
            y: saved.y,
          }]
        : [];
    });
    this.patch({
      placements: {
        ...this.snapshot.placements,
        [workspace.id]: placements,
      },
    });
  }

  markCanvasDocumentReady(): void {
    if (!this.snapshot.isCanvasDocumentReady) {
      this.patch({ isCanvasDocumentReady: true });
    }
  }

  prepareWorkspace(workspace: WorkspaceDetail): void {
    this.reconcile(workspace);
    this.patch({
      isCameraReady: false,
      isCanvasDocumentReady: false,
      selectedItems: [],
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
      searchHighlight: null,
      textArrowSource: null,
      textArrowCursor: null,
    });
    this.resetInteractions();
  }

  leaveWorkspace(): void {
    this.patch({
      activeTool: 'select',
      editingTextId: null,
      isCameraReady: false,
      isCanvasDocumentReady: false,
      selectedItems: [],
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
      searchHighlight: null,
      textArrowSource: null,
      textArrowCursor: null,
    });
    this.resetInteractions();
  }

  forgetWorkspace(workspaceId: string): void {
    const cameras = { ...this.snapshot.cameras };
    const canvasDocuments = { ...this.snapshot.canvasDocuments };
    const placements = { ...this.snapshot.placements };
    const zooms = { ...this.snapshot.zooms };
    delete cameras[workspaceId];
    delete canvasDocuments[workspaceId];
    delete placements[workspaceId];
    delete zooms[workspaceId];
    for (const [key, timer] of this.#entryTimers) {
      if (!key.startsWith(`${workspaceId}:`)) continue;
      window.clearTimeout(timer);
      this.#entryTimers.delete(key);
    }
    const enteringObjects = Object.fromEntries(
      Object.entries(this.snapshot.enteringObjects)
        .filter(([key]) => !key.startsWith(`${workspaceId}:`)),
    );
    this.patch({ cameras, canvasDocuments, enteringObjects, placements, zooms });
  }

  reconcile(workspace: WorkspaceDetail): void {
    const current = this.placementsFor(workspace.id);
    if (!this.snapshot.placements[workspace.id]) return;

    const objects = new Map(
      workspace.objects.map((object) => [object.id, object] as const),
    );
    const placements = current.flatMap((placement) => {
      const object = objects.get(placement.id);
      return object
        ? [{
            ...object,
            height: placement.height,
            width: placement.width,
            x: placement.x,
            y: placement.y,
          }]
        : [];
    });
    this.patch({
      placements: { ...this.snapshot.placements, [workspace.id]: placements },
    });
  }

  updateObject(workspaceId: string, object: ObjectSummary): void {
    const current = this.placementsFor(workspaceId);
    if (!current.some((placement) => placement.id === object.id)) return;
    this.patch({
      placements: {
        ...this.snapshot.placements,
        [workspaceId]: current.map((placement) =>
          placement.id === object.id
            ? {
                ...object,
                height: placement.height,
                width: placement.width,
                x: placement.x,
                y: placement.y,
              }
            : placement,
        ),
      },
    });
  }

  removeObject(workspaceId: string, objectId: string): void {
    const document = this.canvasDocumentFor(workspaceId);
    const removedElementIds = canvasElementIdsForObject(document, objectId);
    let selectedItems = this.snapshot.selectedItems.filter((selection) =>
      !(selection.kind === 'panel' && selection.id === objectId) &&
      !(selection.kind === 'element' && removedElementIds.has(selection.id)),
    );
    const selectedGlobalWasRemoved = document.elements.some(
      (element) =>
        element.id === this.snapshot.selectedGlobalElementId &&
        (removedElementIds.has(element.id) ||
          (element.type === 'arrow' &&
            (element.startAttachment?.objectId === objectId ||
              element.endAttachment?.objectId === objectId))),
    );
    if (selectedGlobalWasRemoved && this.snapshot.selectedGlobalElementId) {
      selectedItems = selectedItems.filter((selection) =>
        selection.id !== this.snapshot.selectedGlobalElementId,
      );
    }
    const selectedPrimary = selectedItems.at(-1);
    this.patch({
      canvasDocuments: {
        ...this.snapshot.canvasDocuments,
        [workspaceId]: {
          ...document,
          elements: document.elements
            .filter((element) => !removedElementIds.has(element.id))
            .map((element) => {
              if (element.type !== 'arrow') return element;
              const next = { ...element };
              if (next.startAttachment?.objectId === objectId) delete next.startAttachment;
              if (next.endAttachment?.objectId === objectId) delete next.endAttachment;
              if (next.startAttachment?.elementId && removedElementIds.has(next.startAttachment.elementId)) {
                delete next.startAttachment;
              }
              if (next.endAttachment?.elementId && removedElementIds.has(next.endAttachment.elementId)) {
                delete next.endAttachment;
              }
              return next;
            }),
          placements: document.placements.filter(
            (placement) => placement.objectId !== objectId,
          ),
        },
      },
      editingTextId: document.elements.some(
        (element) =>
          element.id === this.snapshot.editingTextId && removedElementIds.has(element.id),
      )
        ? null
        : this.snapshot.editingTextId,
      selectedItems,
      placements: {
        ...this.snapshot.placements,
        [workspaceId]: this.placementsFor(workspaceId).filter(
          (placement) => placement.id !== objectId,
        ),
      },
      selectedCardId: selectedPrimary?.kind === 'panel' ? selectedPrimary.id : null,
      selectedElementId: selectedPrimary?.kind === 'element' ? selectedPrimary.id : null,
      selectedGlobalElementId: selectedPrimary?.kind === 'element' ? selectedPrimary.id : null,
      textArrowSource:
        this.snapshot.textArrowSource?.parentObjectId === objectId ||
        (this.snapshot.textArrowSource?.elementId !== undefined &&
          removedElementIds.has(this.snapshot.textArrowSource.elementId))
          ? null
          : this.snapshot.textArrowSource,
      textArrowCursor: this.snapshot.textArrowSource?.parentObjectId === objectId
        ? null
        : this.snapshot.textArrowCursor,
    });
  }

  removeCanvasElement(workspaceId: string, elementId: string): void {
    const document = this.canvasDocumentFor(workspaceId);
    const selectedItems = this.snapshot.selectedItems.filter((selection) =>
      !(selection.kind === 'element' && selection.id === elementId),
    );
    const selectedPrimary = selectedItems.at(-1);
    this.patch({
      canvasDocuments: {
        ...this.snapshot.canvasDocuments,
        [workspaceId]: {
          ...document,
          elements: document.elements
            .filter((element) => element.id !== elementId)
            .map((element) => {
              if (element.type === 'arrow') {
                const detached = { ...element };
                if (detached.startAttachment?.elementId === elementId) delete detached.startAttachment;
                if (detached.endAttachment?.elementId === elementId) delete detached.endAttachment;
                return detached;
              }
              if (
                (element.type !== 'text' && element.type !== 'media') ||
                element.parentElementId !== elementId
              ) return element;
              const detached = { ...element };
              delete detached.parentElementId;
              return detached;
            }),
        },
      },
      editingTextId: this.snapshot.editingTextId === elementId
        ? null
        : this.snapshot.editingTextId,
      selectedItems,
      selectedCardId: selectedPrimary?.kind === 'panel' ? selectedPrimary.id : null,
      selectedElementId: selectedPrimary?.kind === 'element' ? selectedPrimary.id : null,
      selectedGlobalElementId: selectedPrimary?.kind === 'element' ? selectedPrimary.id : null,
      textArrowSource: this.snapshot.textArrowSource?.elementId === elementId
        ? null
        : this.snapshot.textArrowSource,
      textArrowCursor: this.snapshot.textArrowSource?.elementId === elementId
        ? null
        : this.snapshot.textArrowCursor,
    });
  }

  place(
    workspaceId: string,
    object: ObjectSummary,
    point: CanvasPoint,
  ): CanvasPlacement {
    const current = this.placementsFor(workspaceId);
    const wasPlaced = current.some((placement) => placement.id === object.id);
    const previous = current.find((placement) => placement.id === object.id);
    const width =
      previous?.width ?? object.document.frame?.width ?? CANVAS_CARD_WIDTH;
    const height =
      previous?.height ?? object.document.frame?.height ?? CANVAS_CARD_HEIGHT;
    const placement: CanvasPlacement = {
      ...object,
      height,
      width,
      x: point.x,
      y: point.y,
    };
    const placements = wasPlaced
      ? current.map((candidate) =>
          candidate.id === object.id ? placement : candidate,
        )
      : [...current, placement];

    const deltaX = previous ? placement.x - previous.x : 0;
    const deltaY = previous ? placement.y - previous.y : 0;
    const currentDocument = this.canvasDocumentFor(workspaceId);
    const movedElements = previous
      ? translateAttachedArrowGeometry(
          currentDocument.elements,
          {
            elementIds: canvasElementIdsForObject(currentDocument, object.id),
            excludeParentObjectId: object.id,
            objectId: object.id,
          },
          deltaX,
          deltaY,
        )
      : currentDocument.elements;
    const canvasDocument = movedElements === currentDocument.elements
      ? currentDocument
      : { ...currentDocument, elements: movedElements };

    this.patch({
      announcement: wasPlaced
        ? `${object.title} moved to ${point.x}, ${point.y} on the canvas.`
        : `${object.title} added to the canvas at ${point.x}, ${point.y}.`,
      canvasDocuments: canvasDocument === currentDocument
        ? this.snapshot.canvasDocuments
        : { ...this.snapshot.canvasDocuments, [workspaceId]: canvasDocument },
      placements: { ...this.snapshot.placements, [workspaceId]: placements },
    });
    if (!wasPlaced) this.markEntering(workspaceId, object.id);
    return placement;
  }

  /** Move several placed panels by one shared delta while translating any
   * arrows attached to the group exactly once. */
  movePlacements(
    workspaceId: string,
    moves: readonly { placement: CanvasPlacement; point: CanvasPoint }[],
  ): CanvasPlacement[] {
    if (moves.length === 0) return [];
    const current = this.placementsFor(workspaceId);
    const currentById = new Map(current.map((placement) => [placement.id, placement]));
    const unique = new Map<string, { placement: CanvasPlacement; point: CanvasPoint }>();
    for (const move of moves) unique.set(move.placement.id, move);
    const moved = [...unique.values()].map(({ placement, point }) => ({
      ...(currentById.get(placement.id) ?? placement),
      x: point.x,
      y: point.y,
    }));
    if (moved.length === 0) return [];

    const deltas = moved.map((placement) => {
      const previous = currentById.get(placement.id);
      return {
        x: previous ? placement.x - previous.x : 0,
        y: previous ? placement.y - previous.y : 0,
      };
    });
    const firstDelta = deltas[0]!;
    const sharedDelta = deltas.every((delta) =>
      delta.x === firstDelta.x && delta.y === firstDelta.y,
    ) ? firstDelta : null;
    const document = this.canvasDocumentFor(workspaceId);
    let elements = document.elements;
    if (sharedDelta && (sharedDelta.x !== 0 || sharedDelta.y !== 0)) {
      const objectIds = new Set(moved.map((placement) => placement.id));
      const elementIds = new Set<string>();
      for (const objectId of objectIds) {
        for (const elementId of canvasElementIdsForObject(document, objectId)) {
          elementIds.add(elementId);
        }
      }
      elements = translateAttachedArrowGeometry(
        elements,
        {
          elementIds,
          excludeElementIds: elementIds,
          objectIds,
        },
        sharedDelta.x,
        sharedDelta.y,
      );
    } else {
      for (const [index, placement] of moved.entries()) {
        const delta = deltas[index]!;
        if (delta.x === 0 && delta.y === 0) continue;
        const elementIds = canvasElementIdsForObject(document, placement.id);
        elements = translateAttachedArrowGeometry(
          elements,
          {
            elementIds,
            excludeElementIds: elementIds,
            objectId: placement.id,
          },
          delta.x,
          delta.y,
        );
      }
    }
    const movedById = new Map(moved.map((placement) => [placement.id, placement]));
    const placements = current.map((placement) => movedById.get(placement.id) ?? placement);
    for (const placement of moved) {
      if (!currentById.has(placement.id)) placements.push(placement);
    }
    this.patch({
      announcement: moved.length === 1
        ? `${moved[0]!.title} moved to ${moved[0]!.x}, ${moved[0]!.y} on the canvas.`
        : `${moved.length} panels moved on the canvas.`,
      canvasDocuments: elements === document.elements
        ? this.snapshot.canvasDocuments
        : { ...this.snapshot.canvasDocuments, [workspaceId]: { ...document, elements } },
      placements: { ...this.snapshot.placements, [workspaceId]: placements },
    });
    for (const placement of moved) {
      if (!currentById.has(placement.id)) this.markEntering(workspaceId, placement.id);
    }
    return moved;
  }

  announceAlreadyPlaced(object: ObjectSummary): void {
    this.patch({ announcement: `${object.title} is already on the canvas.` });
  }

  isEntering(workspaceId: string, objectId: string): boolean {
    return this.snapshot.enteringObjects[entryKey(workspaceId, objectId)] === true;
  }

  clearEntering(workspaceId: string, objectId: string): void {
    const key = entryKey(workspaceId, objectId);
    if (!this.snapshot.enteringObjects[key]) return;

    const enteringObjects = { ...this.snapshot.enteringObjects };
    delete enteringObjects[key];
    const timer = this.#entryTimers.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    this.#entryTimers.delete(key);
    this.patch({ enteringObjects });
  }

  rememberCamera(workspaceId: string, camera: CanvasCamera): void {
    const current = this.snapshot.cameras[workspaceId];
    if (
      current?.centerX === camera.centerX &&
      current.centerY === camera.centerY
    ) {
      return;
    }
    this.patch({ cameras: { ...this.snapshot.cameras, [workspaceId]: camera } });
  }

  cameraRestored(workspaceId: string, camera: CanvasCamera): void {
    this.patch({
      cameras: { ...this.snapshot.cameras, [workspaceId]: camera },
      isCameraReady: true,
    });
  }

  markCameraReady(): void {
    if (!this.snapshot.isCameraReady) this.patch({ isCameraReady: true });
  }

  setDragging(
    object: ObjectSummary,
    options: { floating: boolean; overCanvas: boolean },
  ): void {
    const floatingObject = options.floating ? object : null;
    if (
      this.snapshot.draggingObjectId === object.id &&
      this.snapshot.floatingObject?.id === floatingObject?.id &&
      this.snapshot.isDropTarget === options.overCanvas
    ) {
      return;
    }
    this.patch({
      draggingObjectId: object.id,
      floatingObject,
      isDropTarget: options.overCanvas,
    });
  }

  setPanning(isPanning: boolean): void {
    if (this.snapshot.isPanning !== isPanning) this.patch({ isPanning });
  }

  resizeObject(
    workspaceId: string,
    objectId: string,
    size: { height: number; width: number },
  ): void {
    const current = this.placementsFor(workspaceId);
    const placement = current.find((candidate) => candidate.id === objectId);
    if (!placement) return;
    const placements = current.map((candidate) =>
      candidate.id === objectId ? { ...candidate, ...size } : candidate,
    );
    this.patch({
      announcement: `${placement.title} resized to ${Math.round(size.width)} by ${Math.round(size.height)}.`,
      placements: { ...this.snapshot.placements, [workspaceId]: placements },
    });
  }

  setResizingObject(objectId: string | null): void {
    if (this.snapshot.resizingObjectId !== objectId) {
      this.patch({ resizingObjectId: objectId });
    }
  }

  selectCard(
    cardId: string | null,
    options: CanvasSelectionOptions = {},
  ): void {
    if (!cardId) {
      this.clearSelection();
      return;
    }
    this.selectItem({ id: cardId, kind: 'panel' }, options);
  }

  selectElement(
    cardId: string,
    elementId: string,
    options: CanvasSelectionOptions = {},
  ): void {
    // `cardId` remains part of the legacy API; element IDs are workspace-wide
    // and are the only identity needed by the selection model.
    void cardId;
    this.selectItem({ id: elementId, kind: 'element' }, options);
  }

  selectGlobalElement(
    elementId: string | null,
    options: CanvasSelectionOptions = {},
  ): void {
    if (!elementId) {
      this.clearSelection();
      return;
    }
    this.selectItem({ id: elementId, kind: 'element' }, options);
  }

  editText(elementId: string | null): void {
    if (elementId) this.selectGlobalElement(elementId);
    this.patch({
      activeTool: elementId ? 'select' : this.snapshot.activeTool,
      editingTextId: elementId,
      ...(elementId
        ? { textArrowCursor: null, textArrowSource: null }
        : {}),
    });
  }

  setTool(activeTool: CanvasTool): void {
    const clearTextArrowSource = activeTool !== 'arrow' && this.snapshot.textArrowSource !== null;
    const clearTextArrowCursor = activeTool !== 'arrow' && this.snapshot.textArrowCursor !== null;
    if (this.snapshot.activeTool !== activeTool || clearTextArrowSource || clearTextArrowCursor) {
      this.patch({
        activeTool,
        ...(clearTextArrowSource ? { textArrowSource: null } : {}),
        ...(clearTextArrowCursor ? { textArrowCursor: null } : {}),
      });
    }
  }

  setTextArrowSource(source: TextArrowSource | null): void {
    if (this.snapshot.textArrowSource === source && this.snapshot.textArrowCursor === null) return;
    this.patch({ textArrowSource: source, textArrowCursor: null });
  }

  setTextArrowCursor(point: CanvasPoint | null): void {
    const previous = this.snapshot.textArrowCursor;
    if (previous?.x === point?.x && previous?.y === point?.y) return;
    this.patch({ textArrowCursor: point });
  }

  setShapeFill(shapeFill: string): void {
    if (this.snapshot.shapeFill !== shapeFill) this.patch({ shapeFill });
  }

  setShapeStroke(shapeStroke: string): void {
    if (this.snapshot.shapeStroke !== shapeStroke) this.patch({ shapeStroke });
  }

  announce(announcement: string): void {
    this.patch({ announcement });
  }

  setSearchHighlight(searchHighlight: CanvasSearchHighlight | null): void {
    if (this.snapshot.searchHighlight === searchHighlight) return;
    this.patch({ searchHighlight });
  }

  resetInteractions(): void {
    if (
      this.snapshot.draggingObjectId === null &&
      this.snapshot.floatingObject === null &&
      !this.snapshot.isDropTarget &&
      !this.snapshot.isPanning &&
      this.snapshot.resizingObjectId === null
    ) {
      return;
    }
    this.patch({
      draggingObjectId: null,
      floatingObject: null,
      isDropTarget: false,
      isPanning: false,
      resizingObjectId: null,
    });
  }

  selectedPanelIds(): string[] {
    return this.snapshot.selectedItems
      .filter((selection) => selection.kind === 'panel')
      .map((selection) => selection.id);
  }

  selectedElementIds(): string[] {
    return this.snapshot.selectedItems
      .filter((selection) => selection.kind === 'element')
      .map((selection) => selection.id);
  }

  private clearSelection(): void {
    if (
      this.snapshot.selectedItems.length === 0 &&
      this.snapshot.selectedCardId === null &&
      this.snapshot.selectedElementId === null &&
      this.snapshot.selectedGlobalElementId === null &&
      this.snapshot.editingTextId === null
    ) return;
    this.patch({
      editingTextId: null,
      selectedItems: [],
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
    });
  }

  private selectItem(
    item: CanvasSelection,
    options: CanvasSelectionOptions,
  ): void {
    const current = this.snapshot.selectedItems;
    const key = selectionKey(item);
    const additive = options.additive === true;
    const hasItem = current.some((selection) => selectionKey(selection) === key);
    const selectedItems = additive
      ? hasItem
        ? current.filter((selection) => selectionKey(selection) !== key)
        : [...current, item]
      : [item];
    const primary = selectedItems.at(-1);
    const selectedCardId = primary?.kind === 'panel' ? primary.id : null;
    const selectedElementId = primary?.kind === 'element' ? primary.id : null;
    const selectedGlobalElementId = selectedElementId;
    const editingTextId = primary?.kind === 'element' &&
      primary.id === this.snapshot.editingTextId &&
      selectedItems.length === 1
      ? this.snapshot.editingTextId
      : null;
    if (
      sameSelection(current, selectedItems) &&
      this.snapshot.selectedCardId === selectedCardId &&
      this.snapshot.selectedElementId === selectedElementId &&
      this.snapshot.selectedGlobalElementId === selectedGlobalElementId &&
      this.snapshot.editingTextId === editingTextId
    ) return;
    this.patch({
      editingTextId,
      selectedItems,
      selectedCardId,
      selectedElementId,
      selectedGlobalElementId,
    });
  }

  private markEntering(workspaceId: string, objectId: string): void {
    const key = entryKey(workspaceId, objectId);
    this.patch({
      enteringObjects: { ...this.snapshot.enteringObjects, [key]: true },
    });
    const currentTimer = this.#entryTimers.get(key);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    this.#entryTimers.set(
      key,
      window.setTimeout(() => this.clearEntering(workspaceId, objectId), 320),
    );
  }

  private patch(patch: Partial<CanvasSnapshot>): void {
    this.publish({ ...this.snapshot, ...patch });
  }
}

function entryKey(workspaceId: string, objectId: string): string {
  return `${workspaceId}:${objectId}`;
}

function sameSelection(
  left: readonly CanvasSelection[],
  right: readonly CanvasSelection[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((selection, index) =>
    selectionKey(selection) === selectionKey(right[index]!),
  );
}
