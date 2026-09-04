<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CanvasPlacement } from '../../lib/domain/canvas';
  import {
    canvasElementIdsForElement,
    type ArrowAttachment,
    type ArrowElement,
    type CanvasElement,
    type RectangleElement,
    type TextArrowSource,
    type TextRangeAnchor,
    type TextElement,
    type WorkspaceCanvasDocument,
  } from '../../lib/domain/workspace';
  import {
    arrowFromGesture,
    continueArrowDraw,
    isArrowDrawValid,
    startArrowDraw,
    type ArrowDrawGesture,
  } from '../../lib/features/arrowDrawing';
  import {
    arrowPoints,
    canvasElementFrame,
    canvasTextRangeFrame,
    canvasTextRangeFrames,
    snapArrow,
    textRangeAnchorPoint,
    textRangeAttachment,
    textRangeAttachmentAtPoint,
  } from '../../lib/features/arrowGeometry';
  import type { ArrowHandle } from '../../lib/features/arrowLive';
  import {
    dispatchCanvasLiveEnd,
    dispatchCanvasLiveMove,
  } from '../../lib/features/canvasLive';
  import {
    canvasApplicationScale,
    CANVAS_CARD_HEADER_HEIGHT,
    CANVAS_TEXT_MAX_WIDTH,
    POINTER_DRAG_THRESHOLD,
  } from '../../lib/features/canvas';
  import {
    isCanvasElementHighlighted,
    isCanvasSelectionActive,
    isCanvasSelectionModifier,
    selectedElementRoots,
    translateCanvasElement,
  } from '../../lib/features/canvasSelection';
  import {
    settleCanvasElement,
    translateAttachedArrowGeometry,
  } from '../../lib/features/elementAttachment';
  import {
    continueRectangleDraw,
    isRectangleDrawValid,
    rectangleGeometry,
    startRectangleDraw,
    type RectangleDrawGesture,
  } from '../../lib/features/rectangleDrawing';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import CanvasRectangle from './CanvasRectangle.svelte';
  import CanvasMediaElement from './CanvasMediaElement.svelte';
  import CanvasTextBlock from './CanvasTextBlock.svelte';
  import CanvasArrow from './CanvasArrow.svelte';

  type Props = {
    canvas: CanvasService;
    document: WorkspaceCanvasDocument;
    placement: CanvasPlacement;
    snapshot: Readonly<CanvasSnapshot>;
    workspaceId: string;
  };

  type MoveGesture = {
    arrowHandle?: ArrowHandle;
    currentX: number;
    currentY: number;
    element: CanvasElement;
    elementIds: readonly string[];
    groupElementIds: readonly string[];
    groupRoots: readonly CanvasElement[];
    kind: 'move';
    selectionToggle?: boolean;
    /** Shift keeps an arrow endpoint at the released point inside a target. */
    preciseArrowPoint?: boolean;
    /** Ctrl/Cmd keeps a text-range endpoint attached while it follows its edge. */
    preserveTextAttachment?: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    visualNodes: HTMLElement[];
  };

  type DragOverflowNode = {
    node: HTMLElement;
    overflow: string;
  };

  let { canvas, document, placement, snapshot, workspaceId }: Props = $props();
  let board = $state<HTMLDivElement>();
  let draftElement: HTMLSpanElement | undefined;
  let draftArrow: SVGSVGElement | undefined;
  let draftArrowLine: SVGLineElement | undefined;
  let gesture: ArrowDrawGesture | RectangleDrawGesture | MoveGesture | null = null;
  let visualFrame: number | null = null;
  let explanationCursorFrame: number | null = null;
  let pendingExplanationCursor: { x: number; y: number } | null = null;
  let pendingPoint: { x: number; y: number } | null = null;
  let lastRectanglePointerDown: { at: number; id: string } | null = null;
  let zoom = $derived(snapshot.zooms[workspaceId] ?? 1);
  let dragOverflowNodes: DragOverflowNode[] = [];
  let elements = $derived(
    document.elements.filter(
      (element) => element.parentObjectId === placement.id,
    ),
  );
  let textArrowHighlights = $derived(
    document.elements.flatMap((element) => {
      if (
        element.type !== 'arrow' ||
        !element.showTextOutline ||
        !element.startAttachment?.elementId
      ) return [];
      const anchor = element.startAttachment.textRange;
      return anchor
        ? [{ anchor, color: element.stroke, elementId: element.startAttachment.elementId }]
        : [];
    }),
  );

  onDestroy(() => {
    cancelVisualFrame();
    if (explanationCursorFrame !== null) window.cancelAnimationFrame?.(explanationCursorFrame);
    clearGestureVisual(gesture);
  });

  function boardPoint(event: PointerEvent, constrained = false) {
    const bounds = board?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const applicationScale = canvasApplicationScale();
    const x = (event.clientX - (bounds?.left ?? 0)) / applicationScale / zoom;
    const y = (event.clientY - (bounds?.top ?? 0)) / applicationScale / zoom;
    return constrained
      ? {
          x: clamp(x, 0, (bounds?.width ?? 0) / applicationScale / zoom),
          y: clamp(y, 0, (bounds?.height ?? 0) / applicationScale / zoom),
        }
      : { x, y };
  }

  function globalPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: placement.x + point.x,
      y: placement.y + CANVAS_CARD_HEADER_HEIGHT + point.y,
    };
  }

  function createArrowDrawGesture(
    point: { x: number; y: number },
    event: PointerEvent,
    source?: ArrowAttachment,
  ): ArrowDrawGesture {
    const draw = startArrowDraw(point, event.pointerId, source);
    if (event.shiftKey) draw.precisePoint = true;
    return draw;
  }

  function startDraw(event: PointerEvent) {
    canvas.state.selectCard(placement.id);
    if (
      event.button === 0 &&
      snapshot.activeTool === 'arrow' &&
      snapshot.textArrowSource &&
      snapshot.isCanvasDocumentReady &&
      snapshot.textArrowSource.parentObjectId === placement.id
    ) {
      event.preventDefault();
      event.stopPropagation();
      beginArmedExplanationInteraction(boardPoint(event, true), event);
      return;
    }
    if (
      event.button === 0 &&
      snapshot.activeTool === 'text' &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      const point = boardPoint(event, true);
      const width = Math.max(100, Math.min(260, placement.width - 20));
      canvas.createTextElement(workspaceId, {
        parentObjectId: placement.id,
        width,
        x: clamp(point.x - 20, 0, placement.width - width),
        y: clamp(
          point.y - 18,
          0,
          placement.height - CANVAS_CARD_HEADER_HEIGHT - 48,
        ),
      });
      return;
    }
    if (
      event.button === 0 &&
      snapshot.activeTool === 'arrow' &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      const point = boardPoint(event, true);
      const source = sourceAtPoint(point, snapshot.textArrowSource);
      if (snapshot.textArrowSource && !source) {
        canvas.state.setTextArrowSource(null);
      }
      gesture = createArrowDrawGesture(point, event, source);
      updateArrowDraft(gesture);
      board?.setPointerCapture?.(event.pointerId);
      return;
    }
    if (
      event.button !== 0 ||
      snapshot.activeTool !== 'rectangle' ||
      !snapshot.isCanvasDocumentReady
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const point = boardPoint(event, true);
    gesture = startRectangleDraw(point, event.pointerId);
    updateDraft(gesture);
    board?.setPointerCapture?.(event.pointerId);
  }

  function startMove(
    event: PointerEvent,
    element: CanvasElement,
    arrowHandle?: ArrowHandle,
  ) {
    // Images/GIFs use a short drag threshold so a click remains a normal
    // selection while preserving a smooth drag. Their promoted pointermove
    // has button=-1 by browser design.
    const deferredMediaDrag = element.type === 'media' && event.type === 'pointermove';
    if (event.button !== 0 && !deferredMediaDrag) return;
    if (
      event.button === 0 &&
      snapshot.activeTool === 'arrow' &&
      snapshot.textArrowSource?.parentObjectId === placement.id &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      beginArmedExplanationInteraction(boardPoint(event, true), event);
      return;
    }
    const now = performance.now();
    const isDoubleClick = element.type === 'rectangle' && (
      event.detail >= 2 ||
      (lastRectanglePointerDown?.id === element.id &&
        now - lastRectanglePointerDown.at <= 450)
    );
    lastRectanglePointerDown = element.type === 'rectangle'
      ? { at: now, id: element.id }
      : null;
    if (isDoubleClick && element.type === 'rectangle') {
      event.preventDefault();
      event.stopPropagation();
      lastRectanglePointerDown = null;
      canvas.editRectangleText(workspaceId, element);
      return;
    }
    const keepGroup = isCanvasSelectionActive(
      canvas.state.snapshot.selectedItems,
      { id: element.id, kind: 'element' },
    );
    if (!keepGroup) {
      canvas.state.selectGlobalElement(element.id, {
        // Ctrl/Cmd/Shift adds this element to the current selection.
        additive: isCanvasSelectionModifier(event),
      });
    }
    event.stopPropagation();
    if (event.button === 0 && snapshot.activeTool === 'text') {
      event.preventDefault();
      if (element.type === 'text') {
        canvas.state.editText(element.id);
      } else if (element.type === 'rectangle') {
        const point = boardPoint(event, true);
        const width = Math.min(260, Math.max(32, element.width));
        canvas.createTextElement(workspaceId, {
          parentElementId: element.id,
          parentObjectId: placement.id,
          width,
          x: clamp(
            point.x - 20,
            element.x,
            element.x + element.width - width,
          ),
          y: clamp(
            point.y - 18,
            element.y,
            element.y + element.height - 48,
          ),
        });
      } else {
        const point = boardPoint(event, true);
        canvas.createTextElement(workspaceId, {
          parentObjectId: element.parentObjectId ?? placement.id,
          width: Math.min(260, Math.max(32, element.width)),
          x: point.x,
          y: point.y,
        });
      }
      return;
    }
    if (event.button === 0 && snapshot.activeTool === 'arrow') {
      event.preventDefault();
      const point = boardPoint(event, true);
      const source = sourceAtPoint(point, snapshot.textArrowSource);
      if (snapshot.textArrowSource && !source) {
        canvas.state.setTextArrowSource(null);
      }
      gesture = createArrowDrawGesture(point, event, source);
      updateArrowDraft(gesture);
      board?.setPointerCapture?.(event.pointerId);
      return;
    }
    // An arrow is edited through its endpoint/control-point handles only.
    // Clicking the stroke still selects it, but never starts a whole-arrow
    // drag that would detach both of its semantic attachments.
    if (element.type === 'arrow' && arrowHandle === undefined) {
      event.preventDefault();
      return;
    }
    if (snapshot.activeTool !== 'select') return;
    event.preventDefault();
    const point = boardPoint(event);
    const boardElements = document.elements.filter(
      (candidate) => candidate.parentObjectId === placement.id,
    );
    const groupRoots = element.type === 'arrow' || arrowHandle !== undefined
      ? [element]
      : selectedElementRoots(
          canvas.state.snapshot.selectedItems,
          boardElements,
          element,
        );
    const groupElementIds = new Set<string>();
    for (const root of groupRoots) {
      for (const id of canvasElementIdsForElement(document.elements, root.id)) {
        groupElementIds.add(id);
      }
    }
    gesture = {
      arrowHandle,
      currentX: point.x,
      currentY: point.y,
      element,
      elementIds: [...groupElementIds],
      groupElementIds: [...groupElementIds],
      groupRoots,
      kind: 'move',
      selectionToggle: keepGroup &&
        arrowHandle === undefined &&
        isCanvasSelectionModifier(event),
      preciseArrowPoint:
        element.type === 'arrow' &&
        (arrowHandle === 'start' || arrowHandle === 'end') &&
        event.shiftKey,
      preserveTextAttachment:
        element.type === 'arrow' &&
        (arrowHandle === 'start' || arrowHandle === 'end') &&
        hasTextRangeAttachment(element, arrowHandle) &&
        isAttachmentPreservingModifier(event),
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      visualNodes: findVisualNodes(element, [...groupElementIds]),
    };
    // The nested board normally clips its children to the panel. Keep the
    // clipping disabled for the whole gesture so an element remains visible
    // while it is being pulled out and is waiting to be re-parented globally.
    beginDragOverflow();
    applyMoveVisual(gesture);
    board?.setPointerCapture?.(event.pointerId);
  }

  function beginRectangleEditing(event: MouseEvent, rectangle: RectangleElement) {
    event.preventDefault();
    event.stopPropagation();
    canvas.editRectangleText(workspaceId, rectangle);
  }

  function continueGesture(event: PointerEvent) {
    if (
      !gesture &&
      snapshot.activeTool === 'arrow' &&
      snapshot.textArrowSource &&
      snapshot.isCanvasDocumentReady
    ) {
      queueExplanationCursor(globalPoint(boardPoint(latestPointerEvent(event), true)));
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    captureShiftPointMode(gesture, event);
    captureTextAttachmentMode(gesture, event);
    event.preventDefault();
    pendingPoint = boardPoint(latestPointerEvent(event), gesture.kind !== 'move');
    if (visualFrame !== null) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      flushGestureVisual();
      return;
    }
    visualFrame = window.requestAnimationFrame(flushGestureVisual);
  }

  async function finishGesture(event: PointerEvent) {
    const active = gesture;
    cancelVisualFrame();
    if (active) {
      captureShiftPointMode(active, event);
      captureTextAttachmentMode(active, event);
      pendingPoint = boardPoint(latestPointerEvent(event), active.kind !== 'move');
      flushGestureVisual();
    }
    const finished = active;
    if (!finished || finished.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (board?.hasPointerCapture?.(event.pointerId)) {
      board.releasePointerCapture(event.pointerId);
    }

    if (
      (finished.kind === 'draw' && !isRectangleDrawValid(finished)) ||
      (finished.kind === 'draw-arrow' && !isArrowDrawValid(finished))
    ) {
      clearGestureVisual(finished);
      gesture = null;
      canvas.state.announce(
        finished.kind === 'draw-arrow'
          ? 'Arrow is too short and was not created.'
          : 'Card is too small and was not created.',
      );
      return;
    }
    if (
      finished.kind === 'move' &&
      finished.selectionToggle &&
      Math.hypot(finished.currentX - finished.startX, finished.currentY - finished.startY) < POINTER_DRAG_THRESHOLD
    ) {
      clearGestureVisual(finished);
      canvas.state.selectGlobalElement(finished.element.id, { additive: true });
      return;
    }
    const keepTextArrowSource = finished.kind === 'draw-arrow' &&
      Boolean(finished.sourceAttachment) &&
      !finished.armedFromSelection;
    canvas.state.setTool(keepTextArrowSource ? 'arrow' : 'select');
    const currentDocument = canvas.state.canvasDocumentFor(workspaceId);

    const created = finished.kind === 'move'
      ? null
      : finished.kind === 'draw'
        ? drawnRectangle(finished)
        : drawnArrow(finished, currentDocument.elements);
    const settled = finished.kind === 'move'
      ? settleMoveGroup(finished, currentDocument.elements)
      : { elements: [created!], primary: created! };
    const element = settled.primary;
    const movedById = new Map(settled.elements.map((candidate) => [candidate.id, candidate]));
    if (finished.kind !== 'move') canvas.state.selectGlobalElement(element.id);
    const exists = currentDocument.elements.some((candidate) => candidate.id === element.id);
    let updatedElements = currentDocument.elements.map((candidate) =>
      movedById.get(candidate.id) ?? candidate,
    );
    if (!exists) updatedElements = [...updatedElements, ...settled.elements];
    if (finished.kind === 'move' && settled.delta) {
      const movedIds = new Set(finished.groupElementIds);
      updatedElements = updatedElements.map((candidate) => {
        if (!movedIds.has(candidate.id) || movedById.has(candidate.id)) return candidate;
        const parentId = 'parentElementId' in candidate
          ? candidate.parentElementId
          : undefined;
        const parent = parentId ? movedById.get(parentId) : undefined;
        return rebaseMovedDescendant(
          candidate,
          parent,
          settled.delta!,
          snapshot.placements[workspaceId] ?? [],
        );
      });
      updatedElements = translateAttachedArrowGeometry(
        updatedElements,
        {
          elementIds: movedIds,
          excludeElementIds: movedIds,
        },
        settled.delta.x,
        settled.delta.y,
      );
    }
    const savePromise = canvas.saveWorkspaceCanvasDocument(workspaceId, {
        elements: updatedElements,
        placements: currentDocument.placements,
        version: 1,
      });
    gesture = null;
    await tick();
    clearGestureVisual(finished);
    try {
      await savePromise;
      const location = (element.type === 'text' || element.type === 'media') && element.parentElementId
        ? 'attached to card'
        : element.parentObjectId
          ? `attached to ${panelTitle(element.parentObjectId)}`
          : 'detached from panel';
      const name = element.type === 'text'
        ? 'Text'
        : element.type === 'media'
          ? 'Media'
          : element.type === 'arrow'
            ? 'Arrow'
            : 'Card';
      canvas.state.announce(
        exists ? `${name} ${location}.` : `${name} added and ${location}.`,
      );
    } catch {
      canvas.state.announce('Canvas element could not be saved.');
    }
  }

  function completeArmedExplanationArrow(
    point: { x: number; y: number },
    event: PointerEvent,
  ): void {
    const source = snapshot.textArrowSource;
    if (!source || source.parentObjectId !== placement.id) return;
    const sourceElement = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === source.elementId && candidate.type === 'text',
    );
    const frame = sourceElement
      ? canvasTextRangeFrame(
          sourceElement,
          source.anchor,
          placement.id,
          snapshot.placements[workspaceId] ?? [],
          canvas.currentZoom(),
        )
      : null;
    if (!sourceElement || !frame) {
      canvas.state.announce('The selected phrase is no longer available.');
      canvas.state.setTextArrowSource(null);
      return;
    }
    const sourceAttachment: ArrowAttachment = {
      elementId: source.elementId,
      objectId: placement.id,
      ...textRangeAttachment(frame, point),
      textRange: source.anchor,
    };
    const frames = canvasTextRangeFrames(
      sourceElement,
      source.anchor,
      placement.id,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    ) ?? [frame];
    const draw = {
      ...continueArrowDraw(
        createArrowDrawGesture(textRangeAnchorPoint(frames, sourceAttachment), event, sourceAttachment),
        point,
      ),
      armedFromSelection: true,
    } satisfies ArrowDrawGesture;
    const candidate = drawnArrow(draw, document.elements);
    if (
      !candidate.endAttachment ||
      candidate.endAttachment.elementId === source.elementId
    ) {
      canvas.state.setTextArrowCursor(globalPoint(point));
      canvas.state.announce('Click a card, text block, panel, or media element to connect the arrow.');
      return;
    }
    gesture = draw;
    pendingPoint = point;
    void finishGesture(event);
  }

  /** Start a source drag when the pointer is on the highlighted phrase; a
   * click anywhere else is treated as the convenient target-click flow. */
  function beginArmedExplanationInteraction(
    point: { x: number; y: number },
    event: PointerEvent,
  ): void {
    const source = snapshot.textArrowSource;
    const sourceAttachment = sourceAtPoint(point, source);
    if (sourceAttachment) {
      canvas.state.setTextArrowCursor(null);
      gesture = createArrowDrawGesture(
        sourceAttachmentPoint(sourceAttachment, point),
        event,
        sourceAttachment,
      );
      updateArrowDraft(gesture);
      board?.setPointerCapture?.(event.pointerId);
      return;
    }
    completeArmedExplanationArrow(point, event);
  }

  function cancelGesture(event: PointerEvent) {
    if (gesture?.pointerId !== event.pointerId) return;
    cancelVisualFrame();
    clearGestureVisual(gesture);
    gesture = null;
    pendingPoint = null;
  }

  function drawnRectangle(draw: RectangleDrawGesture): RectangleElement {
    const bounds = board?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const applicationScale = canvasApplicationScale();
    const geometry = rectangleGeometry(draw, {
      boundsHeight: (bounds?.height ?? placement.height * applicationScale * zoom) / applicationScale / zoom,
      boundsWidth: (bounds?.width ?? placement.width * applicationScale * zoom) / applicationScale / zoom,
      clickHeight: 72,
      clickWidth: 112,
    });
    return {
      fill: snapshot.shapeFill,
      height: geometry.height,
      id: createElementId(),
      parentObjectId: placement.id,
      radius: 10,
      stroke: snapshot.shapeStroke,
      strokeWidth: 2,
      type: 'rectangle',
      width: geometry.width,
      x: geometry.x,
      y: geometry.y,
    };
  }

  function drawnArrow(
    draw: ArrowDrawGesture,
    elements: readonly CanvasElement[],
  ): ArrowElement {
    const arrow = arrowFromGesture(draw, createElementId(), snapshot.shapeStroke, placement.id);
    if (draw.sourceAttachment) {
      const sourceElement = elements.find(
        (candidate): candidate is TextElement =>
          candidate.id === draw.sourceAttachment?.elementId && candidate.type === 'text',
      );
      const range = draw.sourceAttachment.textRange;
      const sourceFrame = sourceElement && range
        ? canvasTextRangeFrame(
            sourceElement,
            range,
            placement.id,
            snapshot.placements[workspaceId] ?? [],
            canvas.currentZoom(),
          )
        : null;
      const sourceFrames = sourceElement && range && sourceFrame
        ? canvasTextRangeFrames(
            sourceElement,
            range,
            placement.id,
            snapshot.placements[workspaceId] ?? [],
            canvas.currentZoom(),
          ) ?? [sourceFrame]
        : [];
      const sourceAttachment = sourceFrame
        ? {
            ...draw.sourceAttachment,
            ...textRangeAttachment(sourceFrame, {
              x: draw.currentX,
              y: draw.currentY,
            }),
          }
        : draw.sourceAttachment;
      // Keep the source gesture immutable; only the committed arrow gets the
      // side/offset chosen for its destination.
      arrow.startAttachment = { ...sourceAttachment };
      const sourcePoint = sourceFrames.length > 0
        ? textRangeAnchorPoint(sourceFrames, sourceAttachment)
        : { x: draw.startX, y: draw.startY };
      arrow.startX = sourcePoint.x;
      arrow.startY = sourcePoint.y;
    }
    const implicitTextControlPoint = Boolean(
      draw.sourceAttachment?.textRange &&
      arrow.controlPoints.length === 1 &&
      isControlPointMidpoint(arrow.controlPoints[0], arrow.startX, arrow.startY, arrow.endX, arrow.endY),
    );
    const snapped = snapArrow(
      arrow,
      elements,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
      {
        preserveEndPoint: draw.precisePoint,
        preserveStartPoint: draw.precisePoint,
      },
    );
    if (!implicitTextControlPoint || snapped.controlPoints.length !== 1) return snapped;
    const points = arrowPoints(
      snapped,
      elements,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    );
    return {
      ...snapped,
      controlPoints: [{
        x: (points.start.x + points.end.x) / 2,
        y: (points.start.y + points.end.y) / 2,
      }],
    };
  }

  function isControlPointMidpoint(
    point: { x: number; y: number },
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): boolean {
    return Math.hypot(
      point.x - (startX + endX) / 2,
      point.y - (startY + endY) / 2,
    ) < 1;
  }

  function movedElementDelta(
    previous: CanvasElement,
    next: CanvasElement,
  ): { x: number; y: number } {
    const placements = snapshot.placements[workspaceId] ?? [];
    const previousFrame = canvasElementFrame(previous, placements);
    const nextFrame = canvasElementFrame(next, placements);
    return previousFrame && nextFrame
      ? {
          x: nextFrame.left - previousFrame.left,
          y: nextFrame.top - previousFrame.top,
        }
      : {
          x: next.x - previous.x,
          y: next.y - previous.y,
        };
  }

  function sourceAtPoint(
    point: { x: number; y: number },
    source: TextArrowSource | null,
  ): ArrowAttachment | undefined {
    if (!source || source.parentObjectId !== placement.id) return undefined;
    const element = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === source.elementId && candidate.type === 'text',
    );
    if (!element) return undefined;
    const frame = canvasTextRangeFrame(
      element,
      source.anchor,
      placement.id,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    );
    if (!frame) return undefined;
    const tolerance = 30;
    const frames = canvasTextRangeFrames(
      element,
      source.anchor,
      placement.id,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    ) ?? [frame];
    const inside = frames.some((candidate) =>
      point.x >= candidate.left - tolerance &&
      point.x <= candidate.right + tolerance &&
      point.y >= candidate.top - tolerance &&
      point.y <= candidate.bottom + tolerance,
    );
    if (!inside) return undefined;
    return {
      elementId: source.elementId,
      objectId: placement.id,
      ...textRangeAttachment(frame, point),
      textRange: source.anchor,
    };
  }

  /** Resolve the drag origin to the visible edge of the selected phrase. */
  function sourceAttachmentPoint(
    attachment: ArrowAttachment,
    fallback: { x: number; y: number },
  ): { x: number; y: number } {
    if (!attachment.textRange || !attachment.elementId) return fallback;
    const element = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === attachment.elementId && candidate.type === 'text',
    );
    if (!element) return fallback;
    const frame = canvasTextRangeFrame(
      element,
      attachment.textRange,
      placement.id,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    );
    if (!frame) return fallback;
    const frames = canvasTextRangeFrames(
      element,
      attachment.textRange,
      placement.id,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    ) ?? [frame];
    return textRangeAnchorPoint(frames, attachment);
  }

  function isAttachmentPreservingModifier(event: PointerEvent): boolean {
    return event.ctrlKey || event.metaKey;
  }

  function attachmentForEndpoint(
    arrow: ArrowElement,
    handle: 'start' | 'end',
  ): ArrowAttachment | undefined {
    return handle === 'start' ? arrow.startAttachment : arrow.endAttachment;
  }

  function hasTextRangeAttachment(
    arrow: ArrowElement,
    handle: ArrowHandle,
  ): boolean {
    return typeof handle !== 'number' &&
      Boolean(attachmentForEndpoint(arrow, handle)?.elementId &&
        attachmentForEndpoint(arrow, handle)?.textRange);
  }

  function projectTextAttachment(
    arrow: ArrowElement,
    handle: 'start' | 'end',
    target: { x: number; y: number },
  ): { attachment: ArrowAttachment; point: { x: number; y: number } } | null {
    const attachment = attachmentForEndpoint(arrow, handle);
    if (!attachment?.elementId || !attachment.textRange) return null;
    const element = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === attachment.elementId && candidate.type === 'text',
    );
    if (!element) return null;
    const placements = snapshot.placements[workspaceId] ?? [];
    const frame = canvasTextRangeFrame(
      element,
      attachment.textRange,
      placement.id,
      placements,
      canvas.currentZoom(),
    );
    if (!frame) return null;
    const frames = canvasTextRangeFrames(
      element,
      attachment.textRange,
      placement.id,
      placements,
      canvas.currentZoom(),
    ) ?? [frame];
    const nextAttachment = textRangeAttachmentAtPoint(frames, target, attachment);
    return {
      attachment: nextAttachment,
      point: textRangeAnchorPoint(frames, nextAttachment),
    };
  }

  function constrainedTextArrowPoint(move: MoveGesture): { x: number; y: number } | null {
    if (
      !move.preserveTextAttachment ||
      move.element.type !== 'arrow' ||
      (move.arrowHandle !== 'start' && move.arrowHandle !== 'end')
    ) return null;
    return projectTextAttachment(
      move.element,
      move.arrowHandle,
      { x: move.currentX, y: move.currentY },
    )?.point ?? null;
  }

  function movedElement(move: MoveGesture): CanvasElement {
    const deltaX = move.currentX - move.startX;
    const deltaY = move.currentY - move.startY;
    if (move.element.type === 'arrow') {
      if (move.arrowHandle === undefined) return move.element;
      const moved: ArrowElement = {
        ...move.element,
        ...(typeof move.arrowHandle === 'number'
          ? {
              controlPoints: move.element.controlPoints.map((point, index) =>
                index === move.arrowHandle
                  ? { x: move.currentX, y: move.currentY }
                  : point,
              ),
            }
          : move.arrowHandle === 'start'
            ? { startX: move.currentX, startY: move.currentY }
            : { endX: move.currentX, endY: move.currentY }),
      };
      if (move.arrowHandle === 'start') {
        const projection = move.preserveTextAttachment
          ? projectTextAttachment(move.element, 'start', {
              x: move.currentX,
              y: move.currentY,
            })
          : null;
        if (projection) {
          moved.startAttachment = projection.attachment;
          moved.startX = projection.point.x;
          moved.startY = projection.point.y;
        } else if (!move.preserveTextAttachment) delete moved.startAttachment;
      } else if (move.arrowHandle === 'end') {
        const projection = move.preserveTextAttachment
          ? projectTextAttachment(move.element, 'end', {
              x: move.currentX,
              y: move.currentY,
            })
          : null;
        if (projection) {
          moved.endAttachment = projection.attachment;
          moved.endX = projection.point.x;
          moved.endY = projection.point.y;
        } else if (!move.preserveTextAttachment) delete moved.endAttachment;
      }
      return moved;
    }
    return {
      ...move.element,
      x: move.element.x + deltaX,
      y: move.element.y + deltaY,
    };
  }

  function settleMovedElement(move: MoveGesture): CanvasElement {
    const moved = movedElement(move);
    if (moved.type === 'arrow') {
      const snapOptions = move.arrowHandle === 'start'
        ? { preserveStartPoint: move.preciseArrowPoint }
        : move.arrowHandle === 'end'
          ? { preserveEndPoint: move.preciseArrowPoint }
          : {};
      return snapArrow(
        moved,
        document.elements,
        snapshot.placements[workspaceId] ?? [],
        canvas.currentZoom(),
        snapOptions,
      );
    }
    const globalX = placement.x + moved.x;
    const globalY = placement.y + CANVAS_CARD_HEADER_HEIGHT + moved.y;
    return settleCanvasElement(
      moved,
      globalX,
      globalY,
      document.elements,
      snapshot.placements[workspaceId] ?? [],
    );
  }

  type SettledMoveGroup = {
    delta?: { x: number; y: number };
    elements: CanvasElement[];
    primary: CanvasElement;
  };

  function settleMoveGroup(
    move: MoveGesture,
    currentElements: readonly CanvasElement[],
  ): SettledMoveGroup {
    const roots = move.groupRoots.length > 0 ? move.groupRoots : [move.element];
    if (roots.length === 1) {
      const primary = settleMovedElement(move);
      return {
        delta: move.element.type === 'arrow'
          ? undefined
          : movedElementDelta(move.element, primary),
        elements: [primary],
        primary,
      };
    }
    const requestedX = move.currentX - move.startX;
    const requestedY = move.currentY - move.startY;
    const availableWidth = Math.max(0, placement.width);
    const availableHeight = Math.max(0, placement.height - CANVAS_CARD_HEADER_HEIGHT);
    let minimumX = Number.NEGATIVE_INFINITY;
    let maximumX = Number.POSITIVE_INFINITY;
    let minimumY = Number.NEGATIVE_INFINITY;
    let maximumY = Number.POSITIVE_INFINITY;
    for (const root of roots) {
      minimumX = Math.max(minimumX, -root.x);
      maximumX = Math.min(maximumX, availableWidth - root.x - root.width);
      minimumY = Math.max(minimumY, -root.y);
      maximumY = Math.min(maximumY, availableHeight - root.y - root.height);
    }
    const delta = {
      x: clamp(requestedX, minimumX, maximumX),
      y: clamp(requestedY, minimumY, maximumY),
    };
    const placements = snapshot.placements[workspaceId] ?? [];
    const settledRoots = roots.map((root) => {
      const moved = translateCanvasElement(root, delta.x, delta.y);
      return settleCanvasElement(
        moved,
        placement.x + moved.x,
        placement.y + CANVAS_CARD_HEADER_HEIGHT + moved.y,
        [...currentElements],
        placements,
      );
    });
    const primary = settledRoots.find((candidate) => candidate.id === move.element.id) ??
      settledRoots[0]!;
    return { delta, elements: settledRoots, primary };
  }

  /** Rebase nested content when its moved parent crosses a panel boundary. */
  function rebaseMovedDescendant(
    element: CanvasElement,
    parent: CanvasElement | undefined,
    delta: { x: number; y: number },
    placements: readonly CanvasPlacement[],
  ): CanvasElement {
    const shifted = translateCanvasElement(element, delta.x, delta.y);
    if (
      parent?.type !== 'rectangle' ||
      (shifted.type !== 'text' && shifted.type !== 'media')
    ) return shifted;
    const previousFrame = canvasElementFrame(element, placements);
    if (!previousFrame) return shifted;
    const globalX = previousFrame.left + delta.x;
    const globalY = previousFrame.top + delta.y;
    if (!parent.parentObjectId) {
      shifted.x = globalX;
      shifted.y = globalY;
      delete shifted.parentObjectId;
      return shifted;
    }
    const nextPlacement = placements.find((candidate) => candidate.id === parent.parentObjectId);
    if (!nextPlacement) return shifted;
    shifted.x = globalX - nextPlacement.x;
    shifted.y = globalY - nextPlacement.y - CANVAS_CARD_HEADER_HEIGHT;
    shifted.parentObjectId = parent.parentObjectId;
    return shifted;
  }

  function findVisualNodes(
    element: CanvasElement,
    descendantIds: readonly string[] = [
      ...canvasElementIdsForElement(document.elements, element.id),
    ],
  ): HTMLElement[] {
    const root = board;
    if (!root) return [];
    const ids = new Set<string>([element.id]);
    for (const id of descendantIds) ids.add(id);
    for (const candidate of document.elements) {
      if (
        candidate.type === 'arrow' &&
        (candidate.startAttachment?.elementId && ids.has(candidate.startAttachment.elementId) ||
          candidate.endAttachment?.elementId && ids.has(candidate.endAttachment.elementId))
      ) {
        ids.add(candidate.id);
      }
    }
    const nodesById = new Map<string, HTMLElement>();
    for (const node of root.querySelectorAll<HTMLElement>('[data-canvas-element-id]')) {
      const id = node.dataset.canvasElementId;
      if (id && !nodesById.has(id)) nodesById.set(id, node);
    }
    return [...ids].flatMap((id) => {
      const node = nodesById.get(id);
      if (!node) return [];
      return [node.closest<HTMLElement>('.canvas-rectangle-shell') ?? node];
    });
  }

  function flushGestureVisual() {
    visualFrame = null;
    const active = gesture;
    const point = pendingPoint;
    pendingPoint = null;
    if (!active || !point) return;
    active.currentX = point.x;
    active.currentY = point.y;
    if (active.kind === 'draw') {
      Object.assign(active, continueRectangleDraw(active, point));
      updateDraft(active);
    } else if (active.kind === 'draw-arrow') {
      Object.assign(active, continueArrowDraw(active, point));
      updateArrowDraft(active);
    } else applyMoveVisual(active);
  }

  function captureShiftPointMode(
    active: ArrowDrawGesture | RectangleDrawGesture | MoveGesture,
    event: PointerEvent,
  ): void {
    if (!event.shiftKey) return;
    if (active.kind === 'draw-arrow') {
      active.precisePoint = true;
      return;
    }
    if (
      active.kind === 'move' &&
      active.element.type === 'arrow' &&
      (active.arrowHandle === 'start' || active.arrowHandle === 'end')
    ) {
      active.preciseArrowPoint = true;
    }
  }

  function captureTextAttachmentMode(
    active: ArrowDrawGesture | RectangleDrawGesture | MoveGesture,
    event: PointerEvent,
  ): void {
    if (
      !isAttachmentPreservingModifier(event) ||
      active.kind !== 'move' ||
      active.element.type !== 'arrow' ||
      (active.arrowHandle !== 'start' && active.arrowHandle !== 'end')
    ) return;
    if (hasTextRangeAttachment(active.element, active.arrowHandle)) {
      active.preserveTextAttachment = true;
    }
  }

  function applyMoveVisual(move: MoveGesture) {
    const point = constrainedTextArrowPoint(move);
    const x = point ? point.x - move.startX : move.currentX - move.startX;
    const y = point ? point.y - move.startY : move.currentY - move.startY;
    const transform = `translate3d(${x}px, ${y}px, 0)`;
    dispatchCanvasLiveMove(move, document.elements, x, y);
    for (const node of move.visualNodes) {
      if (node.classList.contains('canvas-arrow')) continue;
      node.style.transform = transform;
      node.style.willChange = 'transform';
      // Keep attached content above the card while both are lifted into the
      // drag layer. Equal z-index values make an older media-before-card
      // document order paint the card over its own media for the duration of
      // the gesture, which looks like the media vanished until pointerup.
      node.style.zIndex = dragVisualZIndex(node, move.element.id);
    }
  }

  function visualNodeElementId(node: HTMLElement): string | undefined {
    return node.dataset.canvasElementId ??
      node.querySelector<HTMLElement>('[data-canvas-element-id]')?.dataset.canvasElementId;
  }

  function dragVisualZIndex(node: HTMLElement, rootId: string): string {
    if (visualNodeElementId(node) === rootId) return '8';
    if (node.classList.contains('canvas-media') || node.classList.contains('canvas-text-block')) {
      return '10';
    }
    return '9';
  }

  function clearGestureVisual(
    active: ArrowDrawGesture | RectangleDrawGesture | MoveGesture | null,
  ) {
    if (active?.kind === 'move') {
      endDragOverflow();
      dispatchCanvasLiveEnd(active, document.elements);
      for (const node of active.visualNodes) {
        node.style.removeProperty('transform');
        node.style.removeProperty('will-change');
        node.style.removeProperty('z-index');
      }
    }
    if (draftElement) {
      draftElement.style.display = 'none';
      draftElement.classList.remove('nested-rectangle--invalid');
    }
    if (draftArrow) draftArrow.style.display = 'none';
  }

  function beginDragOverflow() {
    const nodes: HTMLElement[] = [];
    let node: HTMLElement | null | undefined = board;
    while (node) {
      nodes.push(node);
      if (node.classList.contains('canvas-surface')) break;
      node = node.parentElement;
    }
    dragOverflowNodes = nodes.map((node) => ({
      node,
      overflow: node.style.overflow,
    }));
    for (const { node } of dragOverflowNodes) {
      // Set the inline value as well as the class. The class keeps the
      // appearance declarative, while the inline value works in WebViews
      // where :has() selectors may be unavailable or delayed during a drag.
      if (node === board) {
        node.classList.add('card-nested-canvas--moving');
      } else if (node.classList.contains('canvas-card')) {
        node.classList.add('canvas-card--nested-element-moving');
      }
      node.style.overflow = 'visible';
    }
  }

  function endDragOverflow() {
    for (const { node, overflow } of dragOverflowNodes) {
      if (node === board) {
        node.classList.remove('card-nested-canvas--moving');
      } else if (node.classList.contains('canvas-card')) {
        node.classList.remove('canvas-card--nested-element-moving');
      }
      node.style.overflow = overflow;
    }
    dragOverflowNodes = [];
  }

  function updateDraft(draw: RectangleDrawGesture) {
    if (!draftElement) return;
    const preview = drawnRectangle(draw);
    draftElement.style.cssText = rectangleStyle(preview);
    draftElement.style.display = 'block';
    draftElement.classList.toggle('nested-rectangle--invalid', !isRectangleDrawValid(draw));
  }

  function updateArrowDraft(draw: ArrowDrawGesture) {
    if (!draftArrow || !draftArrowLine) return;
    draftArrow.style.display = 'block';
    draftArrowLine.setAttribute('x1', `${draw.startX}`);
    draftArrowLine.setAttribute('y1', `${draw.startY}`);
    draftArrowLine.setAttribute('x2', `${draw.currentX}`);
    draftArrowLine.setAttribute('y2', `${draw.currentY}`);
    draftArrowLine.style.opacity = isArrowDrawValid(draw) ? '0.9' : '0.28';
  }

  function cancelVisualFrame() {
    if (visualFrame !== null) window.cancelAnimationFrame?.(visualFrame);
    visualFrame = null;
  }

  function queueExplanationCursor(point: { x: number; y: number }): void {
    pendingExplanationCursor = point;
    if (explanationCursorFrame !== null) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      pendingExplanationCursor = null;
      canvas.state.setTextArrowCursor(point);
      return;
    }
    explanationCursorFrame = window.requestAnimationFrame(() => {
      explanationCursorFrame = null;
      const next = pendingExplanationCursor;
      pendingExplanationCursor = null;
      if (
        next &&
        canvas.state.snapshot.textArrowSource &&
        canvas.state.snapshot.activeTool === 'arrow'
      ) canvas.state.setTextArrowCursor(next);
    });
  }

  function rectangleStyle(element: RectangleElement): string {
    return [
      `left:${element.x}px`,
      `top:${element.y}px`,
      `width:${element.width}px`,
      `height:${element.height}px`,
      `background:${element.fill}`,
      `border:${element.strokeWidth}px solid ${element.stroke}`,
      `border-radius:${element.radius}px`,
    ].join(';');
  }

  function panelTitle(objectId: string): string {
    return snapshot.placements[workspaceId]
      ?.find((candidate) => candidate.id === objectId)?.title ?? 'panel';
  }

  function createElementId(): string {
    return globalThis.crypto?.randomUUID?.() ??
      `rectangle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function latestPointerEvent(event: PointerEvent): PointerEvent {
    const samples = event.getCoalescedEvents?.();
    return samples?.[samples.length - 1] ?? event;
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
  }

  function textArrowHighlightsFor(elementId: string): Array<{ anchor: TextRangeAnchor; color: string }> {
    return textArrowHighlights
      .filter((highlight) => highlight.elementId === elementId)
      .map(({ anchor, color }) => ({ anchor, color }));
  }
</script>

<div
  class="card-nested-canvas"
  class:card-nested-canvas--drawing={snapshot.activeTool === 'arrow' || snapshot.activeTool === 'rectangle' || snapshot.activeTool === 'text'}
  class:card-nested-canvas--text={snapshot.activeTool === 'text'}
  bind:this={board}
  role="application"
  aria-label={`${placement.title} panel`}
  onpointerdown={startDraw}
  onpointermove={continueGesture}
  onpointerup={(event) => void finishGesture(event)}
  onpointercancel={cancelGesture}
>
  {#each elements as element (element.id)}
    {#if element.type === 'rectangle'}
      <CanvasRectangle
        canvas={canvas}
        element={element}
        elementClass="nested-rectangle"
        ariaLabel="Card"
        maxHeight={Math.max(28, placement.height - CANVAS_CARD_HEADER_HEIGHT - element.y)}
        maxWidth={Math.max(32, placement.width - element.x)}
        moving={false}
        onContextMenu={(event) => openContextMenu(event, 'Card', [
          {
            action: () => canvas.state.selectGlobalElement(element.id),
            icon: 'select',
            id: 'select-card',
            label: 'Select Card',
          },
          {
            action: () => canvas.centerSelection({ kind: 'element', id: element.id }),
            icon: 'focus',
            id: 'center-card',
            label: 'Back to center',
          },
          {
            action: () => canvas.state.setTool('text'),
            icon: 'text',
            id: 'text-tool',
            label: 'Text Tool',
          },
          {
            action: () => canvas.deleteCanvasElement(workspaceId, element.id),
            confirmation: 'Delete this card?',
            danger: true,
            icon: 'delete',
            id: 'delete-card',
            label: 'Delete Card',
          },
        ])}
        onDoubleClick={(event, rectangle) => beginRectangleEditing(event, rectangle)}
        onStartMove={startMove}
        selected={isCanvasElementHighlighted(element, snapshot.selectedItems, document.elements)}
        workspaceId={workspaceId}
      />
    {:else if element.type === 'arrow'}
      <CanvasArrow
        arrow={element}
        elements={document.elements}
        onContextMenu={(event) => openContextMenu(event, 'Arrow', [
          {
            action: () => canvas.state.selectGlobalElement(element.id),
            icon: 'select',
            id: 'select-arrow',
            label: 'Select Arrow',
          },
          {
            action: () => canvas.centerSelection({ kind: 'element', id: element.id }),
            icon: 'focus',
            id: 'center-arrow',
            label: 'Back to center',
          },
          {
            action: () => canvas.deleteCanvasElement(workspaceId, element.id),
            confirmation: 'Delete this arrow?',
            danger: true,
            icon: 'delete',
            id: 'delete-arrow',
            label: 'Delete Arrow',
          },
        ])}
        onStartMove={startMove}
        onStartPointMove={startMove}
        placements={snapshot.placements[workspaceId] ?? []}
        selected={isCanvasElementHighlighted(element, snapshot.selectedItems, document.elements)}
        {zoom}
      />
    {:else if element.type === 'text'}
      <CanvasTextBlock
        {canvas}
        arrowHighlights={textArrowHighlightsFor(element.id)}
        arrowSource={snapshot.textArrowSource}
        editing={snapshot.editingTextId === element.id}
        element={element}
        maxHeight={Math.max(
          48,
          placement.height - CANVAS_CARD_HEADER_HEIGHT - element.y,
          element.height,
        )}
        maxWidth={Math.min(
          CANVAS_TEXT_MAX_WIDTH,
          Math.max(100, placement.width - element.x),
        )}
        moving={false}
        onStartMove={startMove}
        selected={isCanvasElementHighlighted(element, snapshot.selectedItems, document.elements)}
        {zoom}
        {workspaceId}
      />
    {:else}
      <CanvasMediaElement
        {canvas}
        element={element}
        explanationTargetMode={snapshot.activeTool === 'arrow' && Boolean(snapshot.textArrowSource)}
        maxHeight={Math.max(72, placement.height - CANVAS_CARD_HEADER_HEIGHT - element.y)}
        maxWidth={Math.max(120, placement.width - element.x)}
        moving={false}
        onContextMenu={(event, view) => openContextMenu(event, element.name, [
          ...(view ? [{
            action: view,
            icon: 'view' as const,
            id: 'view-media',
            label: 'View',
          }] : []),
          {
            action: () => canvas.state.selectGlobalElement(element.id),
            icon: 'select',
            id: 'select-media',
            label: 'Select Media',
          },
          {
            action: () => canvas.centerSelection({ kind: 'element', id: element.id }),
            icon: 'focus',
            id: 'center-media',
            label: 'Back to center',
          },
          {
            action: () => canvas.deleteCanvasElement(workspaceId, element.id),
            confirmation: 'Delete this media?',
            danger: true,
            icon: 'delete',
            id: 'delete-media',
            label: 'Delete Media',
          },
        ])}
        onStartMove={startMove}
        selected={isCanvasElementHighlighted(element, snapshot.selectedItems, document.elements)}
        {workspaceId}
      />
    {/if}
  {/each}

  <span
    bind:this={draftElement}
    class="nested-rectangle nested-rectangle--draft"
    style="display:none"
    aria-hidden="true"
  ></span>

  <svg
    bind:this={draftArrow}
    class="canvas-arrow canvas-arrow--draft"
    style="display:none"
    viewBox={`0 0 ${Math.max(1, placement.width)} ${Math.max(1, placement.height - CANVAS_CARD_HEADER_HEIGHT)}`}
    aria-hidden="true"
  >
    <defs>
      <marker id={`nested-arrow-draft-head-${placement.id}`} markerHeight="6" markerUnits="strokeWidth" markerWidth="6" orient="auto-start-reverse" refX="5" refY="3" viewBox="0 0 6 6">
        <path d="M0 0 6 3 0 6Z" fill="currentColor"></path>
      </marker>
    </defs>
    <line
      bind:this={draftArrowLine}
      marker-end={`url(#nested-arrow-draft-head-${placement.id})`}
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="2.5"
    ></line>
  </svg>

  {#if elements.length === 0}
    <span class="nested-canvas-empty" aria-hidden="true">
      {snapshot.activeTool === 'rectangle'
        ? 'Draw a card here'
        : snapshot.activeTool === 'arrow'
          ? 'Draw an arrow here'
          : 'Add cards here to attach them'}
    </span>
  {/if}
</div>

<style>
  .card-nested-canvas {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: linear-gradient(180deg, rgb(247 251 248 / 78%), rgb(241 247 243 / 62%));
    box-shadow: inset 0 1px rgb(255 255 255 / 88%);
    cursor: default;
    touch-action: none;
  }

  .card-nested-canvas--drawing { cursor: crosshair; }
  .card-nested-canvas--text { cursor: text; }
  :global(.card-nested-canvas--moving) { overflow: visible; }
  .nested-rectangle {
    position: absolute;
    display: block;
    box-sizing: border-box;
    padding: 0;
    box-shadow: 0 5px 14px rgb(42 72 60 / 8%);
    cursor: move;
    touch-action: none;
  }

  .nested-rectangle--draft {
    opacity: 0.72;
    pointer-events: none;
  }

  .canvas-arrow--draft {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    color: #397565;
    opacity: 0.9;
    pointer-events: none;
  }

  :global(.nested-rectangle--invalid) { opacity: 0.28; }

  .nested-canvas-empty {
    position: absolute;
    inset: 0;
    display: grid;
    color: #9aa59f;
    font-size: calc(10px * var(--text-scale));
    font-weight: 560;
    letter-spacing: 0.015em;
    place-items: center;
    pointer-events: none;
  }
</style>
