import { tick } from 'svelte';
import type { CanvasPlacement, CanvasPoint } from '../domain/canvas';
import {
  canvasElementIdsForObject,
  type ObjectSummary,
  type WorkspaceDetail,
} from '../domain/workspace';
import {
  automaticPlacement,
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  canvasApplicationScale,
  clampCanvasPoint,
  moveCanvasPoint,
  POINTER_DRAG_THRESHOLD,
} from '../features/canvas';
import { dispatchArrowLiveDrag } from '../features/arrowLive';
import { CanvasGState } from '../states/CanvasGState';
import type { CanvasBounds } from './CanvasViewportService';
import { CanvasViewportService } from './CanvasViewportService';

type ObjectPointerDrag = {
  canvasCard: HTMLElement | null;
  canvasX: number | null;
  canvasY: number | null;
  clientX: number;
  clientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  hasMoved: boolean;
  object: ObjectSummary;
  objectHeight: number;
  objectWidth: number;
  originCanvasX: number | null;
  originCanvasY: number | null;
  pointerId: number;
  positionElement: HTMLElement | null;
  sourceElement: HTMLElement;
  startedFromCanvasCard: boolean;
  startClientX: number;
  startClientY: number;
  viewportBounds: CanvasBounds | null;
  applicationScale: number;
  liveElementIds: readonly string[];
  group: readonly GroupPanelDrag[];
  selectionToggle: boolean;
  wasOnCanvas: boolean;
};

type GroupPanelDrag = {
  canvasCard: HTMLElement | null;
  liveElementIds: readonly string[];
  originCanvasX: number;
  originCanvasY: number;
  placement: CanvasPlacement;
  positionElement: HTMLElement | null;
};

/** Owns pointer capture and the imperative, frame-rate drag visuals. */
export class CanvasDragService {
  readonly #commitPlacement: (placement: CanvasPlacement) => void;
  readonly #getWorkspace: () => WorkspaceDetail | null;
  readonly #state: CanvasGState;
  readonly #viewport: CanvasViewportService;
  #drag: ObjectPointerDrag | null = null;
  #finishingDrag: ObjectPointerDrag | null = null;
  #floatingCard: HTMLElement | null = null;
  #suppressClickId: string | null = null;

  constructor(
    state: CanvasGState,
    getWorkspace: () => WorkspaceDetail | null,
    viewport: CanvasViewportService,
    commitPlacement: (placement: CanvasPlacement) => void = () => undefined,
  ) {
    this.#state = state;
    this.#getWorkspace = getWorkspace;
    this.#viewport = viewport;
    this.#commitPlacement = commitPlacement;
  }

  get isActive(): boolean {
    return this.#drag !== null;
  }

  attachFloatingCard(element: HTMLElement | null): void {
    this.#floatingCard = element;
    if (element && this.#drag?.hasMoved) this.updateDragVisual(this.#drag);
  }

  handleObjectSourceClick(object: ObjectSummary): void {
    if (this.#suppressClickId === object.id) return;
    this.placeObjectFromKeyboard(object);
  }

  handleObjectSourceKeydown(event: KeyboardEvent, object: ObjectSummary): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.placeObjectFromKeyboard(object);
  }

  start(
    event: PointerEvent,
    object: ObjectSummary,
    panActive: boolean,
    selectionToggle = false,
  ): void {
    if (
      event.button !== 0 ||
      this.#drag ||
      panActive ||
      (event.target as Element | null)?.closest?.('.rich-text-editor')
    ) {
      return;
    }

    const sourceElement = event.currentTarget as HTMLElement;
    const canvasCardRoot = sourceElement.closest<HTMLElement>('.canvas-card');
    const startedFromCanvasCard = canvasCardRoot !== null;
    const workspace = this.#getWorkspace();
    const existing = workspace
      ? this.#state
          .placementsFor(workspace.id)
          .find((placement) => placement.id === object.id)
      : undefined;
    const canvasCard = startedFromCanvasCard
      ? canvasCardRoot
      : this.#viewport.findCard(object.id);
    const positionElement = startedFromCanvasCard
      ? sourceElement.closest<HTMLElement>('.canvas-card-positioner')
      : this.#viewport.findPositioner(object.id);
    const sourceBounds = sourceElement.getBoundingClientRect();
    const grabBounds = positionElement?.getBoundingClientRect() ?? sourceBounds;
    const zoom = workspace ? this.#state.zoomFor(workspace.id) : 1;
    const applicationScale = canvasApplicationScale();
    const liveElementIds = workspace
      ? [...canvasElementIdsForObject(
          this.#state.canvasDocumentFor(workspace.id),
          object.id,
        )]
      : [];
    const group = workspace && existing
      ? this.#state.placementsFor(workspace.id)
          .filter((placement) => this.#state.selectedPanelIds().includes(placement.id))
          .map((placement) => ({
            canvasCard: this.#viewport.findCard(placement.id),
            liveElementIds: [
              ...canvasElementIdsForObject(
                this.#state.canvasDocumentFor(workspace.id),
                placement.id,
              ),
            ],
            originCanvasX: placement.x,
            originCanvasY: placement.y,
            placement,
            positionElement: this.#viewport.findPositioner(placement.id),
          }))
      : [];
    if (existing && !group.some((item) => item.placement.id === existing.id)) {
      group.push({
        canvasCard,
        liveElementIds,
        originCanvasX: existing.x,
        originCanvasY: existing.y,
        placement: existing,
        positionElement,
      });
    }

    if (workspace && existing && canvasCard) {
      this.#state.clearEntering(workspace.id, object.id);
      canvasCard.classList.remove('canvas-card--entering');
    }
    if (positionElement) positionElement.style.willChange = 'transform';
    for (const item of group) {
      item.positionElement?.style.setProperty('will-change', 'transform');
    }

    sourceElement.setPointerCapture?.(event.pointerId);
    this.#drag = {
      canvasCard,
      canvasX: existing?.x ?? null,
      canvasY: existing?.y ?? null,
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetX: startedFromCanvasCard
        ? event.clientX - grabBounds.left
        : ((object.document.frame?.width ?? CANVAS_CARD_WIDTH) * zoom * applicationScale) / 2,
      grabOffsetY: startedFromCanvasCard
        ? event.clientY - grabBounds.top
        : ((object.document.frame?.height ?? CANVAS_CARD_HEIGHT) * zoom * applicationScale) / 2,
      hasMoved: false,
      object,
      objectHeight: existing?.height ?? object.document.frame?.height ?? CANVAS_CARD_HEIGHT,
      objectWidth: existing?.width ?? object.document.frame?.width ?? CANVAS_CARD_WIDTH,
      originCanvasX: existing?.x ?? null,
      originCanvasY: existing?.y ?? null,
      pointerId: event.pointerId,
      positionElement,
      sourceElement,
      startedFromCanvasCard,
      startClientX: event.clientX,
      startClientY: event.clientY,
      viewportBounds: this.#viewport.bounds(),
      applicationScale,
      liveElementIds,
      group,
      selectionToggle,
      wasOnCanvas: existing !== undefined,
    };

    this.updateDragVisual(this.#drag);
  }

  continue(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const sample = this.latestPointerSample(event);

    const wasMoving = drag.hasMoved;
    const hasMoved =
      wasMoving ||
      Math.hypot(
        sample.clientX - drag.startClientX,
        sample.clientY - drag.startClientY,
      ) >= POINTER_DRAG_THRESHOLD;
    const position = this.pointerCanvasPosition(
      sample.clientX,
      sample.clientY,
      drag,
    );
    const overCanvas = position !== null;
    const previousDropTarget = this.#state.snapshot.isDropTarget;

    drag.canvasX = position?.x ?? drag.canvasX;
    drag.canvasY = position?.y ?? drag.canvasY;
    drag.clientX = sample.clientX;
    drag.clientY = sample.clientY;
    drag.hasMoved = hasMoved;
    if (!hasMoved) return;

    event.preventDefault();
    this.#suppressClickId = drag.object.id;
    this.#state.setDragging(drag.object, {
      floating:
        !drag.startedFromCanvasCard && (!drag.wasOnCanvas || !overCanvas),
      overCanvas,
    });
    this.updateDragVisual(drag, overCanvas);

    if (!wasMoving || previousDropTarget !== overCanvas) {
      void this.updateDragVisualAfterRender(drag);
    }
  }

  async finish(event: PointerEvent): Promise<void> {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const sample = this.latestPointerSample(event);

    const hasMoved =
      drag.hasMoved ||
      Math.hypot(
        sample.clientX - drag.startClientX,
        sample.clientY - drag.startClientY,
      ) >= POINTER_DRAG_THRESHOLD;
    if (!hasMoved) {
      if (drag.selectionToggle) {
        this.#state.selectCard(drag.object.id, { additive: true });
      }
      this.clearDragVisual(drag, true);
      this.#drag = null;
      this.releasePointerCapture(drag);
      return;
    }

    event.preventDefault();
    this.#suppressClickId = drag.object.id;
    const position = this.pointerCanvasPosition(
      sample.clientX,
      sample.clientY,
      drag,
    );
    const workspace = this.#getWorkspace();
    if (position && workspace) {
      const committedPoint = clampCanvasPoint(position, {
        height: drag.objectHeight,
        width: drag.objectWidth,
      });
      const points = this.groupPoints(drag, committedPoint);
      this.commitDragVisual(drag, committedPoint);
      if (drag.group.length === 0) {
        const placement = this.#state.place(workspace.id, drag.object, committedPoint);
        this.#commitPlacement(placement);
      } else {
        for (const item of drag.group) {
          const point = points.get(item.placement.id) ?? committedPoint;
          item.positionElement?.style.setProperty(
            'transform',
            positionTransform(point.x, point.y),
          );
        }
        const moved = this.#state.movePlacements(
          workspace.id,
          drag.group.map((item) => ({
            placement: item.placement,
            point: points.get(item.placement.id) ?? committedPoint,
          })),
        );
        for (const placement of moved) {
          this.#commitPlacement(placement);
        }
      }
      // `place` updates the state synchronously, but Svelte does not patch the
      // positioner DOM until the next microtask. Keep the imperative transform
      // and the arrow live offset in place until that patch lands; clearing
      // them immediately makes attached arrow endpoints jump back to the old
      // parent position for one frame on pointer release.
      this.#finishingDrag = drag;
      this.clearDragVisual(drag, false, false);
      this.#drag = null;
      this.#state.resetInteractions();
      window.setTimeout(() => {
        if (this.#suppressClickId === drag.object.id) this.#suppressClickId = null;
      }, 0);
      this.releasePointerCapture(drag);
      void tick().then(() => {
        if (this.#finishingDrag !== drag) return;
        dispatchPanelGroupLiveDrag(drag.group, 0, 0, 'end');
        this.#finishingDrag = null;
      });
      return;
    } else {
      this.resetDrag(drag.object.id, true, true);
    }
    this.releasePointerCapture(drag);
  }

  cancel(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.resetDrag(drag.object.id, drag.hasMoved, true);
    this.releasePointerCapture(drag);
  }

  handleCaptureLost(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (this.#finishingDrag === drag) return;
    this.resetDrag(drag.object.id, drag.hasMoved, true);
  }

  placeObjectFromKeyboard(object: ObjectSummary): void {
    const workspace = this.#getWorkspace();
    if (!workspace) return;
    const placements = this.#state.placementsFor(workspace.id);
    const existing = placements.find((placement) => placement.id === object.id);
    if (existing) {
      this.#state.announceAlreadyPlaced(object);
      void this.#viewport.focusCard(workspace.id, object.id);
      return;
    }

    const point = automaticPlacement(
      this.#viewport.metrics(),
      placements.length,
      {
        height: object.document.frame?.height ?? CANVAS_CARD_HEIGHT,
        width: object.document.frame?.width ?? CANVAS_CARD_WIDTH,
      },
    );
    const placement = this.#state.place(workspace.id, object, point);
    this.#commitPlacement(placement);
    void this.#viewport.focusCard(workspace.id, object.id, 'center');
  }

  /** Places a newly-created panel in the center of the currently visible canvas. */
  placeObjectAtVisibleCenter(object: ObjectSummary): void {
    const workspace = this.#getWorkspace();
    if (!workspace) return;
    const existing = this.#state
      .placementsFor(workspace.id)
      .find((placement) => placement.id === object.id);
    if (existing) {
      void this.#viewport.focusCard(workspace.id, object.id, 'center');
      return;
    }

    const point = automaticPlacement(this.#viewport.metrics(), 0, {
      height: object.document.frame?.height ?? CANVAS_CARD_HEIGHT,
      width: object.document.frame?.width ?? CANVAS_CARD_WIDTH,
    });
    const placement = this.#state.place(workspace.id, object, point);
    this.#commitPlacement(placement);
    void this.#viewport.focusCard(workspace.id, object.id, 'center');
  }

  handleCanvasCardKeydown(
    event: KeyboardEvent,
    placement: CanvasPlacement,
  ): void {
    const point = moveCanvasPoint(
      placement,
      event.key,
      event.shiftKey ? 48 : 24,
      { height: placement.height, width: placement.width },
    );
    if (!point || (point.x === placement.x && point.y === placement.y)) return;

    const workspace = this.#getWorkspace();
    if (!workspace) return;
    event.preventDefault();
    const placements = this.#state.placementsFor(workspace.id);
    const selectedIds = new Set(this.#state.selectedPanelIds());
    const group = selectedIds.has(placement.id)
      ? placements.filter((candidate) => selectedIds.has(candidate.id))
      : [placement];
    if (group.length === 1) {
      const moved = this.#state.place(workspace.id, placement, point);
      this.#commitPlacement(moved);
    } else {
      const delta = constrainedPanelGroupDelta(
        group,
        point.x - placement.x,
        point.y - placement.y,
      );
      const moved = this.#state.movePlacements(
        workspace.id,
        group.map((candidate) => ({
          placement: candidate,
          point: {
            x: candidate.x + delta.x,
            y: candidate.y + delta.y,
          },
        })),
      );
      moved.forEach((candidate) => this.#commitPlacement(candidate));
    }
    void this.#viewport.focusCard(workspace.id, placement.id, 'nearest');
  }

  handleViewportScroll(): void {
    const drag = this.#drag;
    if (!drag?.hasMoved) return;
    const position = this.pointerCanvasPosition(drag.clientX, drag.clientY, drag);
    if (!position) return;
    drag.canvasX = position.x;
    drag.canvasY = position.y;
    this.updateDragVisual(drag, true);
  }

  clear(): void {
    const drag = this.#drag;
    if (drag) {
      this.clearDragVisual(drag, true);
      this.releasePointerCapture(drag);
    }
    const finishing = this.#finishingDrag;
    if (finishing) {
      dispatchPanelGroupLiveDrag(finishing.group, 0, 0, 'end');
    }
    this.#finishingDrag = null;
    this.#drag = null;
    this.#suppressClickId = null;
  }

  private pointerCanvasPosition(
    clientX: number,
    clientY: number,
    drag: ObjectPointerDrag,
  ): CanvasPoint | null {
    drag.viewportBounds ??= this.#viewport.bounds();
    return this.#viewport.canvasPoint(
      clientX,
      clientY,
      drag.grabOffsetX,
      drag.grabOffsetY,
      drag.viewportBounds,
      {
        height: drag.objectHeight,
        width: drag.objectWidth,
      },
      drag.applicationScale,
    );
  }

  private groupDelta(
    drag: ObjectPointerDrag,
  ): { deltaX: number; deltaY: number } {
    const requestedX = drag.canvasX === null || drag.originCanvasX === null
      ? 0
      : drag.canvasX - drag.originCanvasX;
    const requestedY = drag.canvasY === null || drag.originCanvasY === null
      ? 0
      : drag.canvasY - drag.originCanvasY;
    let minimumX = Number.NEGATIVE_INFINITY;
    let maximumX = Number.POSITIVE_INFINITY;
    let minimumY = Number.NEGATIVE_INFINITY;
    let maximumY = Number.POSITIVE_INFINITY;
    for (const item of drag.group) {
      minimumX = Math.max(minimumX, -item.originCanvasX);
      maximumX = Math.min(
        maximumX,
        CANVAS_WIDTH - item.placement.width - item.originCanvasX,
      );
      minimumY = Math.max(minimumY, -item.originCanvasY);
      maximumY = Math.min(
        maximumY,
        CANVAS_HEIGHT - item.placement.height - item.originCanvasY,
      );
    }
    return {
      deltaX: clamp(requestedX, minimumX, maximumX),
      deltaY: clamp(requestedY, minimumY, maximumY),
    };
  }

  private groupPoints(
    drag: ObjectPointerDrag,
    primaryPoint: CanvasPoint,
  ): Map<string, CanvasPoint> {
    const delta = this.groupDelta({
      ...drag,
      canvasX: primaryPoint.x,
      canvasY: primaryPoint.y,
    });
    return new Map(
      drag.group.map((item) => [item.placement.id, {
        x: item.originCanvasX + delta.deltaX,
        y: item.originCanvasY + delta.deltaY,
      }]),
    );
  }

  private updateDragVisual(
    drag: ObjectPointerDrag,
    overCanvas = this.#state.snapshot.isDropTarget,
  ): void {
    const canvasCard = drag.wasOnCanvas ? drag.canvasCard : null;
    const positionElement = drag.wasOnCanvas ? drag.positionElement : null;
    const movesCanvasCards =
      drag.hasMoved &&
      drag.wasOnCanvas &&
      (drag.startedFromCanvasCard || overCanvas) &&
      drag.canvasX !== null &&
      drag.canvasY !== null &&
      drag.originCanvasX !== null &&
      drag.originCanvasY !== null;

    // Эффект зажатия активируется сразу после pointerdown.
    if (canvasCard) {
      canvasCard.classList.toggle(
        'canvas-card--dragging',
        drag.startedFromCanvasCard,
      );
    }
    for (const item of drag.group) {
      item.canvasCard?.classList.toggle(
        'canvas-card--dragging',
        drag.startedFromCanvasCard,
      );
    }

    // Реальное перемещение начинается только после drag threshold.
    if (movesCanvasCards) {
      const { deltaX, deltaY } = this.groupDelta(drag);
      for (const item of drag.group) {
        if (item.positionElement) {
          item.positionElement.style.transform = positionTransform(
            item.originCanvasX + deltaX,
            item.originCanvasY + deltaY,
          );
          item.positionElement.style.zIndex = '6';
        }
      }
      dispatchPanelGroupLiveDrag(drag.group, deltaX, deltaY, 'move');
    } else if (drag.wasOnCanvas) {
      for (const item of drag.group) {
        this.restoreGroupPosition(item);
        item.positionElement?.style.removeProperty('z-index');
      }
      dispatchPanelGroupLiveDrag(drag.group, 0, 0, 'end');
    }

    const floating = this.#floatingCard;
    if (!floating) return;
    const showsFloating =
      drag.hasMoved &&
      !drag.startedFromCanvasCard &&
      (!drag.wasOnCanvas || !overCanvas);
    if (!showsFloating) {
      floating.style.visibility = 'hidden';
      return;
    }

    let visualX = drag.clientX;
    let visualY = drag.clientY;
    const viewport = this.#viewport.element;
    const bounds = drag.viewportBounds;
    if (
      overCanvas &&
      viewport &&
      bounds &&
      drag.canvasX !== null &&
      drag.canvasY !== null
    ) {
      visualX =
        bounds.left + drag.canvasX - viewport.scrollLeft + drag.grabOffsetX;
      visualY =
        bounds.top + drag.canvasY - viewport.scrollTop + drag.grabOffsetY;
    }
    floating.style.transform =
      `translate3d(${visualX}px, ${visualY}px, 0) translate(-50%, -50%) ` +
      `rotate(${overCanvas ? 0 : -0.5}deg) scale(${overCanvas ? 1.015 : 1.01})`;
    floating.style.visibility = 'visible';
  }

  private async updateDragVisualAfterRender(drag: ObjectPointerDrag) {
    await tick();
    if (this.#drag !== drag || !drag.hasMoved) return;
    this.updateDragVisual(drag);
  }

  private commitDragVisual(drag: ObjectPointerDrag, point: CanvasPoint): void {
    if (!drag.positionElement) return;
    drag.positionElement.style.transform = positionTransform(point.x, point.y);
  }

  private clearDragVisual(
    drag: ObjectPointerDrag,
    restorePosition: boolean,
    endLive = true,
  ): void {
    if (restorePosition) this.restorePosition(drag);
    drag.canvasCard?.classList.remove('canvas-card--dragging');
    drag.positionElement?.style.removeProperty('will-change');
    drag.positionElement?.style.removeProperty('z-index');
    for (const item of drag.group) {
      item.canvasCard?.classList.remove('canvas-card--dragging');
      item.positionElement?.style.removeProperty('will-change');
      item.positionElement?.style.removeProperty('z-index');
      if (restorePosition) this.restoreGroupPosition(item);
    }
    if (drag.wasOnCanvas && endLive) {
      if (drag.group.length > 0) {
        dispatchPanelGroupLiveDrag(drag.group, 0, 0, 'end');
      } else {
        dispatchArrowLiveDrag({
          elementIds: drag.liveElementIds,
          objectId: drag.object.id,
          deltaX: 0,
          deltaY: 0,
          phase: 'end',
        });
      }
    }
    this.#floatingCard?.style.removeProperty('transform');
    if (this.#floatingCard) this.#floatingCard.style.visibility = 'hidden';
  }

  private resetDrag(
    objectId: string,
    suppressClick: boolean,
    restorePosition: boolean,
  ): void {
    if (this.#drag) this.clearDragVisual(this.#drag, restorePosition);
    this.#drag = null;
    this.#state.resetInteractions();
    if (!suppressClick) return;

    window.setTimeout(() => {
      if (this.#suppressClickId === objectId) this.#suppressClickId = null;
    }, 0);
  }

  private releasePointerCapture(drag: ObjectPointerDrag): void {
    if (drag.sourceElement.hasPointerCapture?.(drag.pointerId)) {
      drag.sourceElement.releasePointerCapture(drag.pointerId);
    }
  }

  private restorePosition(drag: ObjectPointerDrag): void {
    if (
      !drag.positionElement ||
      drag.originCanvasX === null ||
      drag.originCanvasY === null
    ) {
      return;
    }
    drag.positionElement.style.transform = positionTransform(
      drag.originCanvasX,
      drag.originCanvasY,
    );
  }

  private restoreGroupPosition(item: GroupPanelDrag): void {
    if (!item.positionElement) return;
    item.positionElement.style.transform = positionTransform(
      item.originCanvasX,
      item.originCanvasY,
    );
  }

  private latestPointerSample(event: PointerEvent): PointerEvent {
    const samples = event.getCoalescedEvents?.() ?? [];
    return samples.at(-1) ?? event;
  }
}

function positionTransform(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`;
}

/** Broadcast one live frame for a panel group without letting one panel's
 * event clear an attachment that belongs to another selected panel. */
function dispatchPanelGroupLiveDrag(
  group: readonly GroupPanelDrag[],
  deltaX: number,
  deltaY: number,
  phase: 'end' | 'move',
): void {
  if (group.length === 0) return;
  const elementIds = new Set<string>();
  const objectIds: string[] = [];
  for (const item of group) {
    objectIds.push(item.placement.id);
    for (const elementId of item.liveElementIds) elementIds.add(elementId);
  }
  dispatchArrowLiveDrag({
    deltaX,
    deltaY,
    elementIds: [...elementIds],
    objectIds,
    phase,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}

function constrainedPanelGroupDelta(
  placements: readonly CanvasPlacement[],
  requestedX: number,
  requestedY: number,
): { x: number; y: number } {
  let minimumX = Number.NEGATIVE_INFINITY;
  let maximumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.NEGATIVE_INFINITY;
  let maximumY = Number.POSITIVE_INFINITY;
  for (const placement of placements) {
    minimumX = Math.max(minimumX, -placement.x);
    maximumX = Math.min(maximumX, CANVAS_WIDTH - placement.x - placement.width);
    minimumY = Math.max(minimumY, -placement.y);
    maximumY = Math.min(maximumY, CANVAS_HEIGHT - placement.y - placement.height);
  }
  return {
    x: clamp(requestedX, minimumX, maximumX),
    y: clamp(requestedY, minimumY, maximumY),
  };
}
