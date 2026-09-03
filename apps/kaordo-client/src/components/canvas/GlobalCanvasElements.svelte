<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    canvasElementIdsForElement,
    type ArrowElement,
    type ArrowAttachment,
    type CanvasElement,
    type RectangleElement,
    type TextArrowSource,
    type TextRangeAnchor,
    type TextElement,
    type WorkspaceCanvasDocument,
  } from '../../lib/domain/workspace';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
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
    CANVAS_CARD_HEADER_HEIGHT,
    CANVAS_HEIGHT,
    CANVAS_TEXT_MAX_WIDTH,
    canvasApplicationScale,
  } from '../../lib/features/canvas';
  import {
    moveMediaWithRectangle,
    moveTextWithRectangle,
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
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import CanvasRectangle from './CanvasRectangle.svelte';
  import CanvasMediaElement from './CanvasMediaElement.svelte';
  import CanvasTextBlock from './CanvasTextBlock.svelte';
  import CanvasArrow from './CanvasArrow.svelte';
  import CanvasArrowPreview from './CanvasArrowPreview.svelte';

  type Props = {
    canvas: CanvasService;
    document: WorkspaceCanvasDocument;
    snapshot: Readonly<CanvasSnapshot>;
    workspaceId: string;
  };

  type MoveGesture = {
    arrowHandle?: ArrowHandle;
    currentX: number;
    currentY: number;
    element: CanvasElement;
    elementIds: readonly string[];
    kind: 'move';
    /** Shift keeps an arrow endpoint at the released point inside a target. */
    preciseArrowPoint?: boolean;
    /** Ctrl/Cmd keeps a text-range endpoint attached while it follows its edge. */
    preserveTextAttachment?: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    visualNodes: HTMLElement[];
  };

  let { canvas, document, snapshot, workspaceId }: Props = $props();
  let layer = $state<HTMLDivElement>();
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
  let elements = $derived(
    document.elements.filter((element) => !element.parentObjectId),
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
  let explanationPreview = $derived.by(() => {
    const source = snapshot.textArrowSource;
    const target = snapshot.textArrowCursor;
    if (!source || !target || snapshot.activeTool !== 'arrow') return null;
    const sourceElement = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === source.elementId && candidate.type === 'text',
    );
    const zoom = snapshot.zooms[workspaceId] ?? 1;
    if (!sourceElement) return null;
    const frame = canvasTextRangeFrame(
      sourceElement,
      source.anchor,
      undefined,
      snapshot.placements[workspaceId] ?? [],
      zoom,
    );
    if (!frame) return null;
    const frames = canvasTextRangeFrames(
      sourceElement,
      source.anchor,
      undefined,
      snapshot.placements[workspaceId] ?? [],
      zoom,
    ) ?? [frame];
    const attachment: ArrowAttachment = {
      elementId: source.elementId,
      ...textRangeAttachment(frame, target),
      textRange: source.anchor,
      ...(source.parentObjectId ? { objectId: source.parentObjectId } : {}),
    };
    return {
      end: target,
      id: `selection-${source.elementId}`,
      start: textRangeAnchorPoint(frames, attachment),
      stroke: snapshot.shapeStroke,
    };
  });

  onDestroy(() => {
    cancelVisualFrame();
    if (explanationCursorFrame !== null) window.cancelAnimationFrame?.(explanationCursorFrame);
    clearGestureVisual(gesture);
  });

  function canvasPoint(event: PointerEvent) {
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const applicationScale = canvasApplicationScale();
    return {
      x: clamp(
        (event.clientX - (bounds?.left ?? 0)) / applicationScale / zoom,
        0,
        (bounds?.width ?? 0) / applicationScale / zoom,
      ),
      y: clamp(
        (event.clientY - (bounds?.top ?? 0)) / applicationScale / zoom,
        0,
        (bounds?.height ?? 0) / applicationScale / zoom,
      ),
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
    if (
      event.button === 0 &&
      snapshot.activeTool === 'text' &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      const point = canvasPoint(event);
      const panel = panelAtPoint(point);
      if (panel) {
        canvas.createTextElement(workspaceId, {
          parentObjectId: panel.id,
          width: Math.min(260, Math.max(100, panel.width - 20)),
          x: clamp(point.x - panel.x - 20, 0, panel.width - 260),
          y: clamp(
            point.y - panel.y - CANVAS_CARD_HEADER_HEIGHT - 18,
            0,
            panel.height - CANVAS_CARD_HEADER_HEIGHT - 48,
          ),
        });
        return;
      }
      const bounds = layer?.getBoundingClientRect();
      const zoom = canvas.state.zoomFor(workspaceId);
      const applicationScale = canvasApplicationScale();
      const canvasWidth = (bounds?.width || 4800 * applicationScale * zoom) /
        applicationScale /
        zoom;
      const canvasHeight = (bounds?.height || 3200 * applicationScale * zoom) /
        applicationScale /
        zoom;
      canvas.createTextElement(workspaceId, {
        x: clamp(point.x - 20, 0, canvasWidth - 260),
        y: clamp(point.y - 18, 0, canvasHeight - 48),
      });
      return;
    }
    if (
      event.button === 0 &&
      snapshot.activeTool === 'arrow' &&
      snapshot.textArrowSource &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      beginArmedExplanationInteraction(canvasPoint(event), event);
      return;
    }
    if (
      event.button === 0 &&
      snapshot.activeTool === 'arrow' &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      canvas.state.selectGlobalElement(null);
      const point = canvasPoint(event);
      const source = sourceAtPoint(point, snapshot.textArrowSource);
      if (snapshot.textArrowSource && !source) {
        canvas.state.setTextArrowSource(null);
      }
      gesture = createArrowDrawGesture(point, event, source);
      updateArrowDraft(gesture);
      layer?.setPointerCapture?.(event.pointerId);
      return;
    }
    if (
      event.button !== 0 ||
      snapshot.activeTool !== 'rectangle' ||
      !snapshot.isCanvasDocumentReady
    ) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.state.selectGlobalElement(null);
    const point = canvasPoint(event);
    gesture = startRectangleDraw(point, event.pointerId);
    updateDraft(gesture);
    layer?.setPointerCapture?.(event.pointerId);
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
      snapshot.textArrowSource &&
      snapshot.isCanvasDocumentReady
    ) {
      event.preventDefault();
      event.stopPropagation();
      beginArmedExplanationInteraction(canvasPoint(event), event);
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
    canvas.state.selectGlobalElement(element.id);
    event.stopPropagation();
    if (event.button === 0 && snapshot.activeTool === 'text') {
      event.preventDefault();
      if (element.type === 'text') {
        canvas.state.editText(element.id);
      } else if (element.type === 'rectangle') {
        const point = canvasPoint(event);
        const width = Math.min(260, Math.max(32, element.width));
        canvas.createTextElement(workspaceId, {
          parentElementId: element.id,
          width,
          x: clamp(point.x - 20, element.x, element.x + element.width - width),
          y: clamp(
            point.y - 18,
            element.y,
            element.y + element.height - 48,
          ),
        });
      } else {
        const point = canvasPoint(event);
        canvas.createTextElement(workspaceId, {
          parentObjectId: element.parentObjectId,
          width: Math.min(260, Math.max(32, element.width)),
          x: point.x,
          y: point.y,
        });
      }
      return;
    }
    if (event.button === 0 && snapshot.activeTool === 'arrow') {
      event.preventDefault();
      const point = canvasPoint(event);
      const source = sourceAtPoint(point, snapshot.textArrowSource);
      if (snapshot.textArrowSource && !source) {
        canvas.state.setTextArrowSource(null);
      }
      gesture = createArrowDrawGesture(point, event, source);
      updateArrowDraft(gesture);
      layer?.setPointerCapture?.(event.pointerId);
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
    const point = canvasPoint(event);
    const elementIds = [...canvasElementIdsForElement(document.elements, element.id)];
    gesture = {
      arrowHandle,
      currentX: point.x,
      currentY: point.y,
      element,
      elementIds,
      kind: 'move',
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
      visualNodes: findVisualNodes(element, elementIds),
    };
    applyMoveVisual(gesture);
    layer?.setPointerCapture?.(event.pointerId);
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
      queueExplanationCursor(canvasPoint(latestPointerEvent(event)));
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    captureShiftPointMode(gesture, event);
    captureTextAttachmentMode(gesture, event);
    event.preventDefault();
    pendingPoint = canvasPoint(latestPointerEvent(event));
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
      pendingPoint = canvasPoint(latestPointerEvent(event));
      flushGestureVisual();
    }
    const finished = active;
    if (!finished || finished.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gesture = null;
    if (layer?.hasPointerCapture?.(event.pointerId)) {
      layer.releasePointerCapture(event.pointerId);
    }
    gesture = null;
    if (
      (finished.kind === 'draw' && !isRectangleDrawValid(finished)) ||
      (finished.kind === 'draw-arrow' && !isArrowDrawValid(finished))
    ) {
      clearGestureVisual(finished);
      canvas.state.announce(
        finished.kind === 'draw-arrow'
          ? 'Arrow is too short and was not created.'
          : 'Card is too small and was not created.',
      );
      return;
    }
    const keepTextArrowSource = finished.kind === 'draw-arrow' &&
      Boolean(finished.sourceAttachment) &&
      !finished.armedFromSelection;
    canvas.state.setTool(keepTextArrowSource ? 'arrow' : 'select');
    const currentDocument = canvas.state.canvasDocumentFor(workspaceId);
    const element = finished.kind === 'draw'
      ? drawnRectangle(finished, true, currentDocument.elements)
      : finished.kind === 'draw-arrow'
        ? drawnArrow(finished, currentDocument.elements)
        : settleMovedElement(finished);
    canvas.state.selectGlobalElement(element.id);
    const exists = currentDocument.elements.some((candidate) => candidate.id === element.id);
    let updatedElements = exists
      ? currentDocument.elements.map((candidate) =>
          candidate.id === element.id ? element : candidate,
        )
      : [...currentDocument.elements, element];
    if (
      finished.kind === 'move' &&
      finished.element.type === 'rectangle' &&
      element.type === 'rectangle'
    ) {
      const previousRectangle = finished.element;
      const nextRectangle = element;
      updatedElements = updatedElements.map((candidate) =>
        (candidate.type === 'text' || candidate.type === 'media') &&
        candidate.parentElementId === previousRectangle.id
          ? candidate.type === 'text'
            ? moveTextWithRectangle(candidate, previousRectangle, nextRectangle)
            : moveMediaWithRectangle(candidate, previousRectangle, nextRectangle)
          : candidate,
      );
    }
    if (
      finished.kind === 'move' &&
      finished.element.type !== 'arrow' &&
      element.type !== 'arrow'
    ) {
      const delta = movedElementDelta(finished.element, element);
      updatedElements = translateAttachedArrowGeometry(
        updatedElements,
        { elementIds: new Set(finished.elementIds) },
        delta.x,
        delta.y,
      );
    }
    const savePromise = canvas.saveWorkspaceCanvasDocument(workspaceId, {
        elements: updatedElements,
        placements: currentDocument.placements,
        version: 1,
      });
    // The state changes synchronously before the gateway write. Release the
    // imperative transform on the next render tick so a slow disk never makes
    // the pointer appear stuck.
    await tick();
    clearGestureVisual(finished);
    try {
      await savePromise;
      const location = (element.type === 'text' || element.type === 'media') && element.parentElementId
        ? 'attached to card'
        : element.parentObjectId
          ? 'attached to panel'
          : 'on canvas';
      const name = element.type === 'text'
        ? 'Text'
        : element.type === 'media'
          ? 'Media'
          : element.type === 'arrow'
            ? 'Arrow'
            : 'Card';
      canvas.state.announce(
        exists ? `${name} moved ${location}.` : `${name} added ${location}.`,
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
    if (!source) return;
    const sourceElement = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === source.elementId && candidate.type === 'text',
    );
    const frame = sourceElement
      ? canvasTextRangeFrame(
          sourceElement,
          source.anchor,
          undefined,
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
      ...textRangeAttachment(frame, point),
      textRange: source.anchor,
      ...(source.parentObjectId ? { objectId: source.parentObjectId } : {}),
    };
    const frames = canvasTextRangeFrames(
      sourceElement,
      source.anchor,
      undefined,
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
      canvas.state.setTextArrowCursor(point);
      canvas.state.announce('Click a card, text block, panel, or media element to connect the arrow.');
      return;
    }
    gesture = draw;
    pendingPoint = point;
    void finishGesture(event);
  }

  /**
   * An armed selection supports both interaction styles: drag from the
   * highlighted words for precise placement or click a target for a quick
   * connection. Starting inside the source must never be interpreted as a
   * target click, otherwise the source is lost before the drag begins.
   */
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
      layer?.setPointerCapture?.(event.pointerId);
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

  function drawnRectangle(
    draw: RectangleDrawGesture,
    attach = false,
    elements: readonly CanvasElement[] = document.elements,
  ): RectangleElement {
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const applicationScale = canvasApplicationScale();
    const geometry = rectangleGeometry(draw, {
      boundsHeight: (bounds?.height || 3200 * applicationScale * zoom) /
        applicationScale /
        zoom,
      boundsWidth: (bounds?.width || 4800 * applicationScale * zoom) /
        applicationScale /
        zoom,
      clickHeight: 90,
      clickWidth: 140,
    });
    const rectangle: RectangleElement = {
      fill: snapshot.shapeFill,
      height: geometry.height,
      id: createElementId(),
      radius: 10,
      stroke: snapshot.shapeStroke,
      strokeWidth: 2,
      type: 'rectangle',
      width: geometry.width,
      x: geometry.x,
      y: geometry.y,
    };
    // The global drawing layer sits above panels while a drawing tool is
    // active, so it receives pointer events even when the pointer is over a
    // panel. Set the panel relationship when the card is committed; keeping
    // the draft in global coordinates avoids moving the preview mid-draw.
    return attach
      ? settleCanvasElement(
          rectangle,
          geometry.x,
          geometry.y,
          [...elements],
          snapshot.placements[workspaceId] ?? [],
        ) as RectangleElement
      : rectangle;
  }

  function drawnArrow(
    draw: ArrowDrawGesture,
    elements: readonly CanvasElement[],
  ): ArrowElement {
    const sourceParentObjectId = draw.sourceAttachment?.objectId;
    const sourcePlacement = sourceParentObjectId
      ? snapshot.placements[workspaceId]?.find((candidate) => candidate.id === sourceParentObjectId)
      : undefined;
    const targetPanel = panelAtPoint({ x: draw.currentX, y: draw.currentY });
    const panel = sourceParentObjectId
      ? targetPanel?.id === sourceParentObjectId ? sourcePlacement : undefined
      : draw.sourceAttachment
        ? undefined
        : panelAtPoint({
          x: (draw.startX + draw.currentX) / 2,
          y: (draw.startY + draw.currentY) / 2,
        });
    const localDraw = panel
      ? {
          ...draw,
          currentX: draw.currentX - panel.x,
          currentY: draw.currentY - panel.y - CANVAS_CARD_HEADER_HEIGHT,
          startX: draw.startX - panel.x,
          startY: draw.startY - panel.y - CANVAS_CARD_HEADER_HEIGHT,
        }
      : draw;
    const arrow = arrowFromGesture(
      localDraw,
      createElementId(),
      snapshot.shapeStroke,
      panel?.id,
    );
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
            panel?.id,
            snapshot.placements[workspaceId] ?? [],
            canvas.currentZoom(),
          )
        : null;
      const sourceFrames = sourceElement && range && sourceFrame
        ? canvasTextRangeFrames(
            sourceElement,
            range,
            panel?.id,
            snapshot.placements[workspaceId] ?? [],
            canvas.currentZoom(),
          ) ?? [sourceFrame]
        : [];
      const sourceAttachment = sourceFrame
        ? {
            ...draw.sourceAttachment,
            ...textRangeAttachment(sourceFrame, {
              x: localDraw.currentX,
              y: localDraw.currentY,
            }),
          }
        : draw.sourceAttachment;
      // Keep the source gesture immutable; only the committed arrow gets the
      // side/offset chosen for its destination.
      arrow.startAttachment = { ...sourceAttachment };
      const sourcePoint = sourceFrames.length > 0
        ? textRangeAnchorPoint(sourceFrames, sourceAttachment)
        : { x: localDraw.startX, y: localDraw.startY };
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
    if (!source) return undefined;
    const element = document.elements.find(
      (candidate): candidate is TextElement =>
        candidate.id === source.elementId && candidate.type === 'text',
    );
    if (!element) return undefined;
    const frame = canvasTextRangeFrame(
      element,
      source.anchor,
      undefined,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    );
    if (!frame) return undefined;
    const tolerance = 30;
    const frames = canvasTextRangeFrames(
      element,
      source.anchor,
      undefined,
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
      ...textRangeAttachment(frame, point),
      textRange: source.anchor,
      ...(source.parentObjectId ? { objectId: source.parentObjectId } : {}),
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
      undefined,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    );
    if (!frame) return fallback;
    const frames = canvasTextRangeFrames(
      element,
      attachment.textRange,
      undefined,
      snapshot.placements[workspaceId] ?? [],
      canvas.currentZoom(),
    ) ?? [frame];
    return textRangeAnchorPoint(frames, attachment);
  }

  function panelAtPoint(point: { x: number; y: number }):
    { height: number; id: string; width: number; x: number; y: number } | undefined {
    return [...(snapshot.placements[workspaceId] ?? [])]
      .reverse()
      .find((panel) =>
        point.x >= panel.x &&
        point.x <= panel.x + panel.width &&
        point.y >= panel.y + CANVAS_CARD_HEADER_HEIGHT &&
        point.y <= panel.y + panel.height,
      );
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
      arrow.parentObjectId,
      placements,
      canvas.currentZoom(),
    );
    if (!frame) return null;
    const frames = canvasTextRangeFrames(
      element,
      attachment.textRange,
      arrow.parentObjectId,
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
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const applicationScale = canvasApplicationScale();
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
      x: clamp(
        move.element.x + deltaX,
        0,
        (bounds?.width || 4800 * applicationScale * zoom) /
          applicationScale /
          zoom - move.element.width,
      ),
      y: clamp(
        move.element.y + deltaY,
        0,
        (bounds?.height || 3200 * applicationScale * zoom) /
          applicationScale /
          zoom - move.element.height,
      ),
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
        canvas.state.canvasDocumentFor(workspaceId).elements,
        snapshot.placements[workspaceId] ?? [],
        canvas.currentZoom(),
        snapOptions,
      );
    }
    return settleCanvasElement(
      moved,
      moved.x,
      moved.y,
      canvas.state.canvasDocumentFor(workspaceId).elements,
      snapshot.placements[workspaceId] ?? [],
    );
  }

  function findVisualNodes(
    element: CanvasElement,
    descendantIds: readonly string[] = [
      ...canvasElementIdsForElement(document.elements, element.id),
    ],
  ): HTMLElement[] {
    const root = layer;
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
      dispatchCanvasLiveEnd(active, document.elements);
      for (const node of active.visualNodes) {
        node.style.removeProperty('transform');
        node.style.removeProperty('will-change');
        node.style.removeProperty('z-index');
      }
    }
    if (draftElement) {
      draftElement.style.display = 'none';
      draftElement.classList.remove('global-rectangle--invalid');
    }
    if (draftArrow) draftArrow.style.display = 'none';
  }

  function updateDraft(draw: RectangleDrawGesture) {
    if (!draftElement) return;
    const preview = drawnRectangle(draw);
    draftElement.style.cssText = rectangleStyle(preview);
    draftElement.style.display = 'block';
    draftElement.classList.toggle('global-rectangle--invalid', !isRectangleDrawValid(draw));
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
  class="global-canvas-elements"
  class:global-canvas-elements--drawing={(snapshot.activeTool === 'arrow' || snapshot.activeTool === 'rectangle' || snapshot.activeTool === 'text') && snapshot.isCanvasDocumentReady}
  class:global-canvas-elements--text={snapshot.activeTool === 'text' && snapshot.isCanvasDocumentReady}
  bind:this={layer}
  role="application"
  aria-label="Workspace canvas drawing surface"
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
        elementClass="global-rectangle"
        moving={false}
        onContextMenu={(event) => openContextMenu(event, 'Card', [
          {
            action: () => canvas.state.selectGlobalElement(element.id),
            icon: 'select',
            id: 'select-card',
            label: 'Select Card',
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
        selected={snapshot.selectedGlobalElementId === element.id}
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
        selected={snapshot.selectedGlobalElementId === element.id}
        {zoom}
      />
    {:else if element.type === 'text'}
      <CanvasTextBlock
        {canvas}
        arrowHighlights={textArrowHighlightsFor(element.id)}
        arrowSource={snapshot.textArrowSource}
        editing={snapshot.editingTextId === element.id}
        element={element}
        maxHeight={Math.max(48, CANVAS_HEIGHT - element.y, element.height)}
        maxWidth={CANVAS_TEXT_MAX_WIDTH}
        moving={false}
        onStartMove={startMove}
        selected={snapshot.selectedGlobalElementId === element.id}
        {zoom}
        {workspaceId}
      />
    {:else}
      <CanvasMediaElement
        {canvas}
        element={element}
        explanationTargetMode={snapshot.activeTool === 'arrow' && Boolean(snapshot.textArrowSource)}
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
            action: () => canvas.deleteCanvasElement(workspaceId, element.id),
            confirmation: 'Delete this media?',
            danger: true,
            icon: 'delete',
            id: 'delete-media',
            label: 'Delete Media',
          },
        ])}
        onStartMove={startMove}
        selected={snapshot.selectedGlobalElementId === element.id}
        {workspaceId}
      />
    {/if}
  {/each}

  {#if explanationPreview}
    <CanvasArrowPreview {...explanationPreview} />
  {/if}

  <span
    bind:this={draftElement}
    class="global-rectangle global-rectangle--draft"
    style="display:none"
    aria-hidden="true"
  ></span>

  <svg
    bind:this={draftArrow}
    class="canvas-arrow canvas-arrow--draft"
    style="display:none"
    viewBox={`0 0 4800 3200`}
    aria-hidden="true"
  >
    <defs>
      <marker id="global-arrow-draft-head" markerHeight="6" markerUnits="strokeWidth" markerWidth="6" orient="auto" refX="5" refY="3" viewBox="0 0 6 6">
        <path d="M0 0 6 3 0 6Z" fill="currentColor"></path>
      </marker>
    </defs>
    <line
      bind:this={draftArrowLine}
      marker-end="url(#global-arrow-draft-head)"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="2.5"
    ></line>
  </svg>
</div>

<style>
  .global-canvas-elements {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
    touch-action: none;
  }

  .global-canvas-elements--drawing {
    cursor: crosshair;
    pointer-events: auto;
  }

  .global-canvas-elements--text { cursor: text; }

  .global-rectangle {
    position: absolute;
    display: block;
    box-sizing: border-box;
    padding: 0;
    box-shadow: 0 7px 18px rgb(42 72 60 / 9%);
    cursor: move;
    pointer-events: auto;
    touch-action: none;
  }

  .global-rectangle--draft {
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

  :global(.global-rectangle--invalid) {
    opacity: 0.28;
  }

</style>
