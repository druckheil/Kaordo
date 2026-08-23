<script lang="ts">
  import { onDestroy, tick } from 'svelte';
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
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import CanvasRectangle from './CanvasRectangle.svelte';
  import CanvasMediaElement from './CanvasMediaElement.svelte';
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
    visualNodes: HTMLElement[];
  };

  let { canvas, document, placement, snapshot, workspaceId }: Props = $props();
  let board = $state<HTMLDivElement>();
  let draftElement: HTMLSpanElement | undefined;
  let gesture: RectangleDrawGesture | MoveGesture | null = null;
  let visualFrame: number | null = null;
  let pendingPoint: { x: number; y: number } | null = null;
  let lastRectanglePointerDown: { at: number; id: string } | null = null;
  let elements = $derived(
    document.elements.filter(
      (element) => element.parentObjectId === placement.id,
    ),
  );

  onDestroy(() => {
    cancelVisualFrame();
    clearGestureVisual(gesture);
  });

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
    updateDraft(gesture);
    board?.setPointerCapture?.(event.pointerId);
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
      visualNodes: findVisualNodes(element),
    };
    applyMoveVisual(gesture);
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
    pendingPoint = boardPoint(latestPointerEvent(event), gesture.kind === 'draw');
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
      pendingPoint = boardPoint(latestPointerEvent(event), active.kind === 'draw');
      flushGestureVisual();
    }
    const finished = active;
    if (!finished || finished.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (board?.hasPointerCapture?.(event.pointerId)) {
      board.releasePointerCapture(event.pointerId);
    }

    if (finished.kind === 'draw' && !isRectangleDrawValid(finished)) {
      clearGestureVisual(finished);
      gesture = null;
      canvas.state.announce('Card is too small and was not created.');
      return;
    }
    canvas.state.setTool('select');

    const element = finished.kind === 'draw'
      ? drawnRectangle(finished)
      : settleMovedElement(finished);
    canvas.state.selectGlobalElement(element.id);
    const currentDocument = canvas.state.canvasDocumentFor(workspaceId);
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
      const name = element.type === 'text' ? 'Text' : element.type === 'media' ? 'Media' : 'Card';
      canvas.state.announce(
        exists ? `${name} ${location}.` : `${name} added and ${location}.`,
      );
    } catch {
      canvas.state.announce('Card could not be saved.');
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

  function findVisualNodes(element: CanvasElement): HTMLElement[] {
    const root = board;
    if (!root) return [];
    const ids = new Set<string>([element.id]);
    if (element.type === 'rectangle') {
      for (const child of document.elements) {
        if ('parentElementId' in child && child.parentElementId === element.id) {
          ids.add(child.id);
        }
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
    } else applyMoveVisual(active);
  }

  function applyMoveVisual(move: MoveGesture) {
    const transform = `translate3d(${move.currentX - move.startX}px, ${move.currentY - move.startY}px, 0)`;
    for (const node of move.visualNodes) {
      node.style.transform = transform;
      node.style.willChange = 'transform';
      node.style.zIndex = '8';
    }
  }

  function clearGestureVisual(active: RectangleDrawGesture | MoveGesture | null) {
    if (active?.kind === 'move') {
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
  }

  function updateDraft(draw: RectangleDrawGesture) {
    if (!draftElement) return;
    const preview = drawnRectangle(draw);
    draftElement.style.cssText = rectangleStyle(preview);
    draftElement.style.display = 'block';
    draftElement.classList.toggle('nested-rectangle--invalid', !isRectangleDrawValid(draw));
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
    {:else if element.type === 'text'}
      <CanvasTextBlock
        {canvas}
        editing={snapshot.editingTextId === element.id}
        element={element}
        maxWidth={Math.max(100, placement.width - element.x)}
        moving={false}
        onStartMove={startMove}
        selected={snapshot.selectedGlobalElementId === element.id}
        {workspaceId}
      />
    {:else}
      <CanvasMediaElement
        {canvas}
        element={element}
        maxHeight={Math.max(72, placement.height - CANVAS_CARD_HEADER_HEIGHT - element.y)}
        maxWidth={Math.max(120, placement.width - element.x)}
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
    class="nested-rectangle nested-rectangle--draft"
    style="display:none"
    aria-hidden="true"
  ></span>

  {#if elements.length === 0}
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
