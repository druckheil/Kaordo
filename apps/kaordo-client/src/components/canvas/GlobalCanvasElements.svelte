<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type {
    ArrowElement,
    CanvasElement,
    RectangleElement,
    WorkspaceCanvasDocument,
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
  import { arrowPoints, snapArrow } from '../../lib/features/arrowGeometry';
  import type { ArrowHandle } from '../../lib/features/arrowLive';
  import {
    dispatchCanvasLiveEnd,
    dispatchCanvasLiveMove,
  } from '../../lib/features/canvasLive';
  import {
    moveMediaWithRectangle,
    moveTextWithRectangle,
    settleCanvasElement,
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
    kind: 'move';
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
  let pendingPoint: { x: number; y: number } | null = null;
  let lastRectanglePointerDown: { at: number; id: string } | null = null;
  let elements = $derived(
    document.elements.filter((element) => !element.parentObjectId),
  );

  onDestroy(() => {
    cancelVisualFrame();
    clearGestureVisual(gesture);
  });

  function canvasPoint(event: PointerEvent) {
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    return {
      x: clamp(
        (event.clientX - (bounds?.left ?? 0)) / zoom,
        0,
        (bounds?.width ?? 0) / zoom,
      ),
      y: clamp(
        (event.clientY - (bounds?.top ?? 0)) / zoom,
        0,
        (bounds?.height ?? 0) / zoom,
      ),
    };
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
      const bounds = layer?.getBoundingClientRect();
      const zoom = canvas.state.zoomFor(workspaceId);
      canvas.createTextElement(workspaceId, {
        x: clamp(point.x - 20, 0, (bounds?.width || 4800) / zoom - 260),
        y: clamp(point.y - 18, 0, (bounds?.height || 3200) / zoom - 48),
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
      canvas.state.selectGlobalElement(null);
      const point = canvasPoint(event);
      gesture = startArrowDraw(point, event.pointerId);
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
    // Images/GIFs use a short drag threshold so a click can still open the
    // viewer. Their promoted pointermove has button=-1 by browser design.
    const deferredMediaDrag = element.type === 'media' && event.type === 'pointermove';
    if (event.button !== 0 && !deferredMediaDrag) return;
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
      gesture = startArrowDraw(point, event.pointerId);
      updateArrowDraft(gesture);
      layer?.setPointerCapture?.(event.pointerId);
      return;
    }
    if (snapshot.activeTool !== 'select') return;
    event.preventDefault();
    const point = canvasPoint(event);
    gesture = {
      arrowHandle,
      currentX: point.x,
      currentY: point.y,
      element,
      kind: 'move',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      visualNodes: findVisualNodes(element),
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
    if (!gesture || gesture.pointerId !== event.pointerId) return;
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
    canvas.state.setTool('select');
    const currentDocument = canvas.state.canvasDocumentFor(workspaceId);
    const element = finished.kind === 'draw'
      ? drawnRectangle(finished)
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

  function cancelGesture(event: PointerEvent) {
    if (gesture?.pointerId !== event.pointerId) return;
    cancelVisualFrame();
    clearGestureVisual(gesture);
    gesture = null;
    pendingPoint = null;
  }

  function drawnRectangle(draw: RectangleDrawGesture): RectangleElement {
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const geometry = rectangleGeometry(draw, {
      boundsHeight: (bounds?.height ?? 3200 * zoom) / zoom,
      boundsWidth: (bounds?.width ?? 4800 * zoom) / zoom,
      clickHeight: 90,
      clickWidth: 140,
    });
    return {
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
  }

  function drawnArrow(
    draw: ArrowDrawGesture,
    elements: readonly CanvasElement[],
  ): ArrowElement {
    const arrow = arrowFromGesture(draw, createElementId(), snapshot.shapeStroke);
    return snapArrow(arrow, elements, snapshot.placements[workspaceId] ?? []);
  }

  function movedElement(move: MoveGesture): CanvasElement {
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const deltaX = move.currentX - move.startX;
    const deltaY = move.currentY - move.startY;
    if (move.element.type === 'arrow') {
      if (move.arrowHandle !== undefined) {
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
        if (move.arrowHandle === 'start') delete moved.startAttachment;
        else if (move.arrowHandle === 'end') delete moved.endAttachment;
        return moved;
      }
      if (Math.hypot(deltaX, deltaY) < 0.5) return move.element;
      const resolved = arrowPoints(
        move.element,
        document.elements,
        snapshot.placements[workspaceId] ?? [],
      );
      const moved: ArrowElement = {
        ...move.element,
        endX: resolved.end.x + deltaX,
        endY: resolved.end.y + deltaY,
        startX: resolved.start.x + deltaX,
        startY: resolved.start.y + deltaY,
        controlPoints: move.element.controlPoints.map((point) => ({
          x: point.x + deltaX,
          y: point.y + deltaY,
        })),
        x: move.element.x + deltaX,
        y: move.element.y + deltaY,
      };
      delete moved.startAttachment;
      delete moved.endAttachment;
      return moved;
    }
    return {
      ...move.element,
      x: clamp(
        move.element.x + deltaX,
        0,
        (bounds?.width ?? move.element.width) / zoom - move.element.width,
      ),
      y: clamp(
        move.element.y + deltaY,
        0,
        (bounds?.height ?? move.element.height) / zoom - move.element.height,
      ),
    };
  }

  function settleMovedElement(move: MoveGesture): CanvasElement {
    const moved = movedElement(move);
    if (moved.type === 'arrow') {
      return snapArrow(
        moved,
        canvas.state.canvasDocumentFor(workspaceId).elements,
        snapshot.placements[workspaceId] ?? [],
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

  function findVisualNodes(element: CanvasElement): HTMLElement[] {
    const root = layer;
    if (!root) return [];
    const ids = new Set<string>([element.id]);
    if (element.type === 'rectangle') {
      for (const child of document.elements) {
        if ('parentElementId' in child && child.parentElementId === element.id) {
          ids.add(child.id);
        }
      }
    }
    for (const candidate of document.elements) {
      if (
        candidate.type === 'arrow' &&
        (candidate.startAttachment?.elementId && ids.has(candidate.startAttachment.elementId) ||
          candidate.endAttachment?.elementId && ids.has(candidate.endAttachment.elementId))
      ) {
        ids.add(candidate.id);
      }
    }
    return [...ids].flatMap((id) => {
      const node = [...root.querySelectorAll<HTMLElement>('[data-canvas-element-id]')]
        .find((candidate) => candidate.dataset.canvasElementId === id);
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

  function applyMoveVisual(move: MoveGesture) {
    const x = move.currentX - move.startX;
    const y = move.currentY - move.startY;
    const transform = `translate3d(${x}px, ${y}px, 0)`;
    dispatchCanvasLiveMove(move, document.elements, x, y);
    for (const node of move.visualNodes) {
      if (node.classList.contains('canvas-arrow') && (move.arrowHandle !== undefined || move.element.type !== 'arrow')) {
        continue;
      }
      node.style.transform = transform;
      node.style.willChange = 'transform';
      node.style.zIndex = '8';
    }
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
      />
    {:else if element.type === 'text'}
      <CanvasTextBlock
        {canvas}
        editing={snapshot.editingTextId === element.id}
        element={element}
        moving={false}
        onStartMove={startMove}
        selected={snapshot.selectedGlobalElementId === element.id}
        {workspaceId}
      />
    {:else}
      <CanvasMediaElement
        {canvas}
        element={element}
        moving={false}
        onContextMenu={(event) => openContextMenu(event, element.name, [
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
