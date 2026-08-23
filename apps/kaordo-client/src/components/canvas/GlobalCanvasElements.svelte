<script lang="ts">
  import type {
    CanvasElement,
    RectangleElement,
    WorkspaceCanvasDocument,
  } from '../../lib/domain/workspace';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
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

  type Props = {
    canvas: CanvasService;
    document: WorkspaceCanvasDocument;
    snapshot: Readonly<CanvasSnapshot>;
    workspaceId: string;
  };

  type MoveGesture = {
    currentX: number;
    currentY: number;
    element: CanvasElement;
    kind: 'move';
    pointerId: number;
    startX: number;
    startY: number;
  };

  let { canvas, document, snapshot, workspaceId }: Props = $props();
  let layer = $state<HTMLDivElement>();
  let gesture = $state<RectangleDrawGesture | MoveGesture | null>(null);
  let optimisticElement = $state<CanvasElement | null>(null);
  let lastRectanglePointerDown: { at: number; id: string } | null = null;
  let elements = $derived(
    document.elements.filter((element) => !element.parentObjectId),
  );
  let preview = $derived(previewRectangle());
  let previewInvalid = $derived(
    gesture?.kind === 'draw' && !isRectangleDrawValid(gesture),
  );

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
      event.button !== 0 ||
      snapshot.activeTool !== 'rectangle' ||
      !snapshot.isCanvasDocumentReady
    ) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.state.selectGlobalElement(null);
    const point = canvasPoint(event);
    gesture = startRectangleDraw(point, event.pointerId);
    layer?.setPointerCapture?.(event.pointerId);
  }

  function startMove(event: PointerEvent, element: CanvasElement) {
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
    if (snapshot.activeTool !== 'select') return;
    event.preventDefault();
    const point = canvasPoint(event);
    gesture = {
      currentX: point.x,
      currentY: point.y,
      element,
      kind: 'move',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
    };
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
    const point = canvasPoint(latestPointerEvent(event));
    gesture = gesture.kind === 'draw'
      ? continueRectangleDraw(gesture, point)
      : { ...gesture, currentX: point.x, currentY: point.y };
  }

  async function finishGesture(event: PointerEvent) {
    const active = gesture;
    const point = active ? canvasPoint(latestPointerEvent(event)) : null;
    const finished = active && point
      ? active.kind === 'draw'
        ? continueRectangleDraw(active, point)
        : { ...active, currentX: point.x, currentY: point.y }
      : active;
    if (!finished || finished.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gesture = null;
    if (layer?.hasPointerCapture?.(event.pointerId)) {
      layer.releasePointerCapture(event.pointerId);
    }
    if (finished.kind === 'draw' && !isRectangleDrawValid(finished)) {
      canvas.state.announce('Card is too small and was not created.');
      return;
    }
    canvas.state.setTool('select');
    const element = finished.kind === 'draw'
      ? drawnRectangle(finished)
      : settleMovedElement(finished);
    optimisticElement = element;
    canvas.state.selectGlobalElement(element.id);
    const exists = document.elements.some((candidate) => candidate.id === element.id);
    let updatedElements = exists
      ? document.elements.map((candidate) =>
          candidate.id === element.id ? element : candidate,
        )
      : [...document.elements, element];
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
    try {
      await canvas.saveWorkspaceCanvasDocument(workspaceId, {
        elements: updatedElements,
        placements: document.placements,
        version: 1,
      });
      const location = (element.type === 'text' || element.type === 'media') && element.parentElementId
        ? 'attached to card'
        : element.parentObjectId
          ? 'attached to panel'
          : 'on canvas';
      const name = element.type === 'text' ? 'Text' : element.type === 'media' ? 'Media' : 'Card';
      canvas.state.announce(
        exists ? `${name} moved ${location}.` : `${name} added ${location}.`,
      );
    } catch {
      canvas.state.announce('Card could not be saved.');
    } finally {
      optimisticElement = null;
    }
  }

  function cancelGesture(event: PointerEvent) {
    if (gesture?.pointerId === event.pointerId) gesture = null;
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

  function movedElement(move: MoveGesture): CanvasElement {
    const bounds = layer?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    return {
      ...move.element,
      x: clamp(
        move.element.x + move.currentX - move.startX,
        0,
        (bounds?.width ?? move.element.width) / zoom - move.element.width,
      ),
      y: clamp(
        move.element.y + move.currentY - move.startY,
        0,
        (bounds?.height ?? move.element.height) / zoom - move.element.height,
      ),
    };
  }

  function settleMovedElement(move: MoveGesture): CanvasElement {
    const moved = movedElement(move);
    return settleCanvasElement(
      moved,
      moved.x,
      moved.y,
      document.elements,
      snapshot.placements[workspaceId] ?? [],
    );
  }

  function previewRectangle(): RectangleElement | null {
    return gesture?.kind === 'draw' ? drawnRectangle(gesture) : null;
  }

  function displayedElement(element: CanvasElement): CanvasElement {
    if (optimisticElement?.id === element.id) return optimisticElement;
    if (gesture?.kind === 'move' && gesture.element.id === element.id) {
      return movedElement(gesture);
    }
    if (
      gesture?.kind === 'move' &&
      gesture.element.type === 'rectangle' &&
      (element.type === 'text' || element.type === 'media') &&
      element.parentElementId === gesture.element.id
    ) {
      const moved = movedElement(gesture);
      if (moved.type === 'rectangle') {
        return element.type === 'text'
          ? moveTextWithRectangle(element, gesture.element, moved)
          : moveMediaWithRectangle(element, gesture.element, moved);
      }
    }
    return element;
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
  class:global-canvas-elements--drawing={(snapshot.activeTool === 'rectangle' || snapshot.activeTool === 'text') && snapshot.isCanvasDocumentReady}
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
    {@const displayed = displayedElement(element)}
    {#if displayed.type === 'rectangle'}
      <CanvasRectangle
        canvas={canvas}
        element={displayed}
        elementClass="global-rectangle"
        moving={gesture?.kind === 'move' && gesture.element.id === element.id}
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
    {:else if displayed.type === 'text'}
      <CanvasTextBlock
        {canvas}
        editing={snapshot.editingTextId === element.id}
        element={displayed}
        moving={gesture?.kind === 'move' && (
          gesture.element.id === element.id ||
          (element.type === 'text' &&
            element.parentElementId === gesture.element.id)
        )}
        onStartMove={startMove}
        selected={snapshot.selectedGlobalElementId === element.id}
        {workspaceId}
      />
    {:else}
      <CanvasMediaElement
        {canvas}
        element={displayed}
        moving={gesture?.kind === 'move' && (
          gesture.element.id === element.id ||
          (element.type === 'media' && element.parentElementId === gesture.element.id)
        )}
        onContextMenu={(event) => openContextMenu(event, displayed.name, [
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

  {#if optimisticElement?.type === 'rectangle' && !optimisticElement.parentObjectId && !elements.some((element) => element.id === optimisticElement?.id)}
    <span class="global-rectangle global-rectangle--selected" style={rectangleStyle(optimisticElement)} aria-hidden="true"></span>
  {/if}

  {#if preview}
    <span
      class="global-rectangle global-rectangle--draft"
      class:global-rectangle--invalid={previewInvalid}
      style={rectangleStyle(preview)}
      aria-hidden="true"
    ></span>
  {/if}
</div>

{#if gesture?.kind === 'move'}
  {@const dragged = movedElement(gesture)}
  <div class="global-element-drag-layer" aria-hidden="true">
    {#if dragged.type === 'rectangle'}
      <span
        class="global-rectangle global-rectangle--drag-preview global-rectangle--selected"
        style={rectangleStyle(dragged)}
      ></span>
      {#each document.elements.filter((element) =>
        (element.type === 'text' || element.type === 'media') && element.parentElementId === dragged.id
      ) as child (child.id)}
        {#if child.type === 'text' && gesture.element.type === 'rectangle'}
          <CanvasTextBlock
            {canvas}
            editing={false}
            element={moveTextWithRectangle(child, gesture.element, dragged)}
            onStartMove={() => undefined}
            selected={false}
            {workspaceId}
          />
        {:else if child.type === 'media' && gesture.element.type === 'rectangle'}
          <CanvasMediaElement
            {canvas}
            element={moveMediaWithRectangle(child, gesture.element, dragged)}
            moving={false}
            onStartMove={() => undefined}
            selected={false}
            {workspaceId}
          />
        {/if}
      {/each}
    {:else if dragged.type === 'text'}
      <CanvasTextBlock
        {canvas}
        editing={false}
        element={dragged}
        onStartMove={() => undefined}
        selected={true}
        {workspaceId}
      />
    {:else}
      <CanvasMediaElement
        {canvas}
        element={dragged}
        moving={false}
        onStartMove={() => undefined}
        selected={true}
        {workspaceId}
      />
    {/if}
  </div>
{/if}

<style>
  .global-canvas-elements {
    position: absolute;
    inset: 0;
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

  .global-rectangle--selected {
    outline: 2px solid rgb(47 117 96 / 46%);
    outline-offset: 3px;
  }

  .global-rectangle--draft {
    opacity: 0.72;
    pointer-events: none;
  }

  .global-rectangle--invalid {
    opacity: 0.28;
  }

  .global-element-drag-layer {
    position: absolute;
    inset: 0;
    z-index: 7;
    overflow: visible;
    pointer-events: none;
  }

  .global-rectangle--drag-preview {
    opacity: 0.94;
    box-shadow:
      0 16px 34px rgb(35 67 54 / 18%),
      0 3px 10px rgb(35 67 54 / 10%);
    pointer-events: none;
  }
</style>
