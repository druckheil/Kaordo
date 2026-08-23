import type {
  CanvasCamera,
  CanvasPlacement,
  CanvasPoint,
} from '../domain/canvas';
import type {
  ObjectSummary,
  WorkspaceCanvasDocument,
  WorkspaceDetail,
} from '../domain/workspace';
import { CANVAS_CARD_HEIGHT, CANVAS_CARD_WIDTH } from '../features/canvas';
import { CANVAS_DEFAULT_ZOOM, clampCanvasZoom } from '../features/canvas';
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
  placements: Record<string, CanvasPlacement[]>;
  selectedCardId: string | null;
  selectedElementId: string | null;
  selectedGlobalElementId: string | null;
  shapeFill: string;
  shapeStroke: string;
  zooms: Record<string, number>;
};

export type CanvasTool = 'rectangle' | 'select' | 'text';

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
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
      shapeFill: '#dcece5',
      shapeStroke: '#397565',
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
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
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
    this.patch({ isCameraReady: false, isCanvasDocumentReady: false });
    this.resetInteractions();
  }

  leaveWorkspace(): void {
    this.patch({
      activeTool: 'select',
      editingTextId: null,
      isCameraReady: false,
      isCanvasDocumentReady: false,
      selectedCardId: null,
      selectedElementId: null,
      selectedGlobalElementId: null,
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
    this.patch({
      canvasDocuments: {
        ...this.snapshot.canvasDocuments,
        [workspaceId]: {
          ...document,
          elements: document.elements.filter(
            (element) => element.parentObjectId !== objectId,
          ),
          placements: document.placements.filter(
            (placement) => placement.objectId !== objectId,
          ),
        },
      },
      editingTextId: document.elements.some(
        (element) =>
          element.id === this.snapshot.editingTextId &&
          element.parentObjectId === objectId,
      )
        ? null
        : this.snapshot.editingTextId,
      placements: {
        ...this.snapshot.placements,
        [workspaceId]: this.placementsFor(workspaceId).filter(
          (placement) => placement.id !== objectId,
        ),
      },
      selectedCardId: this.snapshot.selectedCardId === objectId
        ? null
        : this.snapshot.selectedCardId,
      selectedGlobalElementId: document.elements.some(
        (element) =>
          element.id === this.snapshot.selectedGlobalElementId &&
          element.parentObjectId === objectId,
      )
        ? null
        : this.snapshot.selectedGlobalElementId,
    });
  }

  removeCanvasElement(workspaceId: string, elementId: string): void {
    const document = this.canvasDocumentFor(workspaceId);
    this.patch({
      canvasDocuments: {
        ...this.snapshot.canvasDocuments,
        [workspaceId]: {
          ...document,
          elements: document.elements
            .filter((element) => element.id !== elementId)
            .map((element) => {
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
      selectedGlobalElementId: this.snapshot.selectedGlobalElementId === elementId
        ? null
        : this.snapshot.selectedGlobalElementId,
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

    this.patch({
      announcement: wasPlaced
        ? `${object.title} moved to ${point.x}, ${point.y} on the canvas.`
        : `${object.title} added to the canvas at ${point.x}, ${point.y}.`,
      placements: { ...this.snapshot.placements, [workspaceId]: placements },
    });
    if (!wasPlaced) this.markEntering(workspaceId, object.id);
    return placement;
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

  selectCard(cardId: string | null): void {
    if (
      this.snapshot.selectedCardId !== cardId ||
      this.snapshot.selectedGlobalElementId !== null
    ) {
      this.patch({
        editingTextId: null,
        selectedCardId: cardId,
        selectedElementId: null,
        selectedGlobalElementId: null,
      });
    }
  }

  selectElement(cardId: string, elementId: string): void {
    if (
      this.snapshot.selectedCardId !== cardId ||
      this.snapshot.selectedElementId !== elementId
    ) {
      this.patch({
        editingTextId: null,
        selectedCardId: cardId,
        selectedElementId: elementId,
        selectedGlobalElementId: null,
      });
    }
  }

  selectGlobalElement(elementId: string | null): void {
    if (
      this.snapshot.selectedGlobalElementId !== elementId ||
      this.snapshot.selectedCardId !== null ||
      this.snapshot.selectedElementId !== null
    ) {
      this.patch({
        editingTextId:
          this.snapshot.editingTextId === elementId
            ? this.snapshot.editingTextId
            : null,
        selectedCardId: null,
        selectedElementId: null,
        selectedGlobalElementId: elementId,
      });
    }
  }

  editText(elementId: string | null): void {
    this.patch({
      activeTool: elementId ? 'select' : this.snapshot.activeTool,
      editingTextId: elementId,
      selectedCardId: elementId ? null : this.snapshot.selectedCardId,
      selectedElementId: elementId ? null : this.snapshot.selectedElementId,
      selectedGlobalElementId:
        elementId ?? this.snapshot.selectedGlobalElementId,
    });
  }

  setTool(activeTool: CanvasTool): void {
    if (this.snapshot.activeTool !== activeTool) this.patch({ activeTool });
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
