import { tick } from 'svelte';
import type { CanvasPlacement, CanvasPoint } from '../domain/canvas';
import type { ObjectSummary, WorkspaceDetail } from '../domain/workspace';
import {
  automaticPlacement,
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  clampCanvasPoint,
  moveCanvasPoint,
  POINTER_DRAG_THRESHOLD,
} from '../features/canvas';
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
  wasOnCanvas: boolean;
};

/** Owns pointer capture and the imperative, frame-rate drag visuals. */
export class CanvasDragService {
  readonly #commitPlacement: (placement: CanvasPlacement) => void;
  readonly #getWorkspace: () => WorkspaceDetail | null;
  readonly #state: CanvasGState;
  readonly #viewport: CanvasViewportService;
  #drag: ObjectPointerDrag | null = null;
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

  start(event: PointerEvent, object: ObjectSummary, panActive: boolean): void {
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

    if (workspace && existing && canvasCard) {
      this.#state.clearEntering(workspace.id, object.id);
      canvasCard.classList.remove('canvas-card--entering');
    }
    if (positionElement) positionElement.style.willChange = 'transform';

    sourceElement.setPointerCapture?.(event.pointerId);
    this.#drag = {
      canvasCard,
      canvasX: existing?.x ?? null,
      canvasY: existing?.y ?? null,
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetX: startedFromCanvasCard
        ? event.clientX - grabBounds.left
        : ((object.document.frame?.width ?? CANVAS_CARD_WIDTH) * zoom) / 2,
      grabOffsetY: startedFromCanvasCard
        ? event.clientY - grabBounds.top
        : ((object.document.frame?.height ?? CANVAS_CARD_HEIGHT) * zoom) / 2,
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

  finish(event: PointerEvent): void {
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
      this.commitDragVisual(drag, committedPoint);
      const placement = this.#state.place(
        workspace.id,
        drag.object,
        committedPoint,
      );
      this.#commitPlacement(placement);
      this.resetDrag(drag.object.id, true, false);
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
    const moved = this.#state.place(workspace.id, placement, point);
    this.#commitPlacement(moved);
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
    );
  }

  private updateDragVisual(
    drag: ObjectPointerDrag,
    overCanvas = this.#state.snapshot.isDropTarget,
  ): void {
    const canvasCard = drag.wasOnCanvas ? drag.canvasCard : null;
    const positionElement = drag.wasOnCanvas ? drag.positionElement : null;
    const movesCanvasCard =
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

    // Реальное перемещение начинается только после drag threshold.
    if (canvasCard && positionElement && movesCanvasCard) {
      positionElement.style.transform = positionTransform(
        drag.canvasX!,
        drag.canvasY!,
      );
      positionElement.style.zIndex = '6';
    } else if (canvasCard && positionElement) {
      this.restorePosition(drag);
      positionElement.style.removeProperty('z-index');
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
  ): void {
    if (restorePosition) this.restorePosition(drag);
    drag.canvasCard?.classList.remove('canvas-card--dragging');
    drag.positionElement?.style.removeProperty('will-change');
    drag.positionElement?.style.removeProperty('z-index');
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

  private latestPointerSample(event: PointerEvent): PointerEvent {
    const samples = event.getCoalescedEvents?.() ?? [];
    return samples.at(-1) ?? event;
  }
}

function positionTransform(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`;
}
