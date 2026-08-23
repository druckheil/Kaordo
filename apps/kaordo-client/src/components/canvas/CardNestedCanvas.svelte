<script lang="ts">
  import type { CanvasPlacement } from '../../lib/domain/canvas';
  import type {
    CanvasElement,
    RectangleElement,
    WorkspaceCanvasDocument,
  } from '../../lib/domain/workspace';
  import {
    CANVAS_CARD_HEADER_HEIGHT,
  } from '../../lib/features/canvas';
  import {
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
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import CanvasRectangle from './CanvasRectangle.svelte';
  import CanvasTextBlock from './CanvasTextBlock.svelte';

  type Props = {
    canvas: CanvasService;
    document: WorkspaceCanvasDocument;
    placement: CanvasPlacement;
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

  let { canvas, document, placement, snapshot, workspaceId }: Props = $props();
  let board = $state<HTMLDivElement>();
  let gesture = $state<RectangleDrawGesture | MoveGesture | null>(null);
  let optimisticElement = $state<CanvasElement | null>(null);
  let lastRectanglePointerDown: { at: number; id: string } | null = null;
  let elements = $derived(
    document.elements.filter(
      (element) => element.parentObjectId === placement.id,
    ),
  );
  let preview = $derived(previewRectangle());
  let previewInvalid = $derived(
    gesture?.kind === 'draw' && !isRectangleDrawValid(gesture),
  );

  function boardPoint(event: PointerEvent, constrained = false) {
    const bounds = board?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const x = (event.clientX - (bounds?.left ?? 0)) / zoom;
    const y = (event.clientY - (bounds?.top ?? 0)) / zoom;
    return constrained
      ? {
          x: clamp(x, 0, (bounds?.width ?? 0) / zoom),
          y: clamp(y, 0, (bounds?.height ?? 0) / zoom),
        }
      : { x, y };
  }

  function startDraw(event: PointerEvent) {
    canvas.state.selectCard(placement.id);
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
      event.button !== 0 ||
      snapshot.activeTool !== 'rectangle' ||
      !snapshot.isCanvasDocumentReady
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const point = boardPoint(event, true);
    gesture = startRectangleDraw(point, event.pointerId);
    board?.setPointerCapture?.(event.pointerId);
  }

  function startMove(event: PointerEvent, element: CanvasElement) {
    if (event.button !== 0) return;
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
      } else {
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
      }
      return;
    }
    if (snapshot.activeTool !== 'select') return;
    event.preventDefault();
    const point = boardPoint(event);
    gesture = {
      currentX: point.x,
      currentY: point.y,
      element,
      kind: 'move',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
    };
    board?.setPointerCapture?.(event.pointerId);
  }

  function beginRectangleEditing(event: MouseEvent, rectangle: RectangleElement) {
    event.preventDefault();
    event.stopPropagation();
    canvas.editRectangleText(workspaceId, rectangle);
  }

  function continueGesture(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = boardPoint(
      latestPointerEvent(event),
      gesture.kind === 'draw',
    );
    gesture = gesture.kind === 'draw'
      ? continueRectangleDraw(gesture, point)
      : { ...gesture, currentX: point.x, currentY: point.y };
  }

  async function finishGesture(event: PointerEvent) {
    const active = gesture;
    const point = active
      ? boardPoint(latestPointerEvent(event), active.kind === 'draw')
      : null;
    const finished = active && point
      ? active.kind === 'draw'
        ? continueRectangleDraw(active, point)
        : { ...active, currentX: point.x, currentY: point.y }
      : active;
    if (!finished || finished.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gesture = null;
    if (board?.hasPointerCapture?.(event.pointerId)) {
      board.releasePointerCapture(event.pointerId);
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
        candidate.type === 'text' &&
        candidate.parentElementId === previousRectangle.id
          ? moveTextWithRectangle(candidate, previousRectangle, nextRectangle)
          : candidate,
      );
    }
    try {
      await canvas.saveWorkspaceCanvasDocument(workspaceId, {
        elements: updatedElements,
        placements: document.placements,
        version: 1,
      });
      const location = element.type === 'text' && element.parentElementId
        ? 'attached to card'
        : element.parentObjectId
          ? `attached to ${panelTitle(element.parentObjectId)}`
          : 'detached from panel';
      const name = element.type === 'text' ? 'Text' : 'Card';
      canvas.state.announce(
        exists ? `${name} ${location}.` : `${name} added and ${location}.`,
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
    const bounds = board?.getBoundingClientRect();
    const zoom = canvas.state.zoomFor(workspaceId);
    const geometry = rectangleGeometry(draw, {
      boundsHeight: (bounds?.height ?? placement.height * zoom) / zoom,
      boundsWidth: (bounds?.width ?? placement.width * zoom) / zoom,
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

  function movedElement(move: MoveGesture): CanvasElement {
    return {
      ...move.element,
      x: move.element.x + move.currentX - move.startX,
      y: move.element.y + move.currentY - move.startY,
    };
  }

  function settleMovedElement(move: MoveGesture): CanvasElement {
    const moved = movedElement(move);
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
      element.type === 'text' &&
      element.parentElementId === gesture.element.id
    ) {
      const moved = movedElement(gesture);
      if (moved.type === 'rectangle') {
        return moveTextWithRectangle(element, gesture.element, moved);
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
</script>

<div
  class="card-nested-canvas"
  class:card-nested-canvas--drawing={snapshot.activeTool === 'rectangle' || snapshot.activeTool === 'text'}
  class:card-nested-canvas--text={snapshot.activeTool === 'text'}
  class:card-nested-canvas--moving={gesture?.kind === 'move'}
  bind:this={board}
  role="application"
  aria-label={`${placement.title} panel`}
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
        elementClass="nested-rectangle"
        ariaLabel="Card"
        maxHeight={Math.max(28, placement.height - CANVAS_CARD_HEADER_HEIGHT - displayed.y)}
        maxWidth={Math.max(32, placement.width - displayed.x)}
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
    {:else}
      <CanvasTextBlock
        {canvas}
        editing={snapshot.editingTextId === element.id}
        element={displayed}
        maxWidth={Math.max(100, placement.width - displayed.x)}
        onStartMove={startMove}
        selected={snapshot.selectedGlobalElementId === element.id}
        {workspaceId}
      />
    {/if}
  {/each}

  {#if optimisticElement?.type === 'rectangle' && optimisticElement.parentObjectId === placement.id && !elements.some((element) => element.id === optimisticElement?.id)}
    <span class="nested-rectangle nested-rectangle--selected" style={rectangleStyle(optimisticElement)} aria-hidden="true"></span>
  {/if}

  {#if preview}
    <span
      class="nested-rectangle nested-rectangle--draft"
      class:nested-rectangle--invalid={previewInvalid}
      style={rectangleStyle(preview)}
      aria-hidden="true"
    ></span>
  {/if}

  {#if elements.length === 0 && !preview && !optimisticElement}
    <span class="nested-canvas-empty" aria-hidden="true">
      {snapshot.activeTool === 'rectangle' ? 'Draw a card here' : 'Add cards here to attach them'}
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
  .card-nested-canvas--moving { overflow: visible; }

  .nested-rectangle {
    position: absolute;
    display: block;
    box-sizing: border-box;
    padding: 0;
    box-shadow: 0 5px 14px rgb(42 72 60 / 8%);
    cursor: move;
    touch-action: none;
  }

  .nested-rectangle--selected {
    outline: 2px solid rgb(47 117 96 / 42%);
    outline-offset: 3px;
  }

  .nested-rectangle--draft {
    opacity: 0.72;
    pointer-events: none;
  }

  .nested-rectangle--invalid { opacity: 0.28; }

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
