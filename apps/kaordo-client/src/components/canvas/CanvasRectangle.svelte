<script lang="ts">
  import type { RectangleElement } from '../../lib/domain/workspace';
  import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
  } from '../../lib/features/canvas';
  import {
    RECTANGLE_DRAW_MIN_HEIGHT,
    RECTANGLE_DRAW_MIN_WIDTH,
  } from '../../lib/features/rectangleDrawing';
  import type { CanvasService } from '../../lib/services/CanvasService';

  type Props = {
    ariaLabel?: string;
    canvas: CanvasService;
    element: RectangleElement;
    elementClass: 'global-rectangle' | 'nested-rectangle';
    maxHeight?: number;
    maxWidth?: number;
    moving?: boolean;
    onContextMenu: (event: MouseEvent) => void;
    onDoubleClick: (event: MouseEvent, element: RectangleElement) => void;
    onStartMove: (event: PointerEvent, element: RectangleElement) => void;
    selected: boolean;
    workspaceId: string;
  };

  type ResizeGesture = {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startHeight: number;
    startWidth: number;
  };

  let {
    ariaLabel = 'Canvas card',
    canvas,
    element,
    elementClass,
    maxHeight,
    maxWidth,
    moving = false,
    onContextMenu,
    onDoubleClick,
    onStartMove,
    selected,
    workspaceId,
  }: Props = $props();
  let resize = $state<ResizeGesture | null>(null);
  let resizedSize = $state<{ height: number; width: number } | null>(null);

  let visual = $derived({
    ...element,
    ...(resizedSize ?? {}),
  });
  let widthLimit = $derived(
    Math.max(
      RECTANGLE_DRAW_MIN_WIDTH,
      maxWidth ?? CANVAS_WIDTH - element.x - 40,
    ),
  );
  let heightLimit = $derived(
    Math.max(
      RECTANGLE_DRAW_MIN_HEIGHT,
      maxHeight ?? CANVAS_HEIGHT - element.y - 40,
    ),
  );

  function startResize(event: PointerEvent) {
    if (event.button !== 0 || resize) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    resize = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startHeight: element.height,
      startWidth: element.width,
    };
    resizedSize = {
      height: element.height,
      width: element.width,
    };
  }

  function continueResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizedSize = sizeFromPointer(event);
  }

  function finishResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const size = sizeFromPointer(event);
    const handle = event.currentTarget as HTMLElement;
    resize = null;
    resizedSize = null;
    if (handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    if (size.width === element.width && size.height === element.height) return;
    void saveSize(size);
  }

  function cancelResize(event: PointerEvent) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    resize = null;
    resizedSize = null;
    if (handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown'
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 40 : 12;
    const current = resizedSize ?? element;
    const size = {
      height: current.height + (
        event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
      ),
      width: current.width + (
        event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
      ),
    };
    const next = {
      height: clamp(size.height, RECTANGLE_DRAW_MIN_HEIGHT, heightLimit),
      width: clamp(size.width, RECTANGLE_DRAW_MIN_WIDTH, widthLimit),
    };
    resizedSize = next;
    void saveSize(next).finally(() => {
      if (!resize) resizedSize = null;
    });
  }

  function sizeFromPointer(event: PointerEvent) {
    const active = resize;
    if (!active) {
      return {
        height: element.height,
        width: element.width,
      };
    }
    const zoom = canvas.currentZoom();
    return {
      height: Math.round(clamp(
        active.startHeight + (event.clientY - active.startClientY) / zoom,
        RECTANGLE_DRAW_MIN_HEIGHT,
        heightLimit,
      )),
      width: Math.round(clamp(
        active.startWidth + (event.clientX - active.startClientX) / zoom,
        RECTANGLE_DRAW_MIN_WIDTH,
        widthLimit,
      )),
    };
  }

  async function saveSize(size: { height: number; width: number }) {
    try {
      await canvas.resizeCanvasCard(workspaceId, element, size);
    } catch {
      canvas.state.announce('Card size could not be saved.');
    }
  }

  function rectangleStyle() {
    return [
      `width:${visual.width}px`,
      `height:${visual.height}px`,
      `background:${visual.fill}`,
      `border:${visual.strokeWidth}px solid ${visual.stroke}`,
      `border-radius:${visual.radius}px`,
    ].join(';');
  }

  function shellStyle() {
    return [
      `left:${visual.x}px`,
      `top:${visual.y}px`,
      `width:${visual.width}px`,
      `height:${visual.height}px`,
    ].join(';');
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
  }
</script>

<div
  class="canvas-rectangle-shell"
  class:canvas-rectangle-shell--resizing={resize !== null}
  style={shellStyle()}
>
  <button
    class={`${elementClass}${moving ? ` ${elementClass}--moving-source` : ''}${selected ? ` ${elementClass}--selected` : ''}`}
    data-canvas-element-id={element.id}
    type="button"
    aria-label={ariaLabel}
    style={rectangleStyle()}
    onpointerdown={(event) => onStartMove(event, element)}
    ondblclick={(event) => onDoubleClick(event, element)}
    oncontextmenu={onContextMenu}
  ></button>
  {#if selected && !moving}
    <button
      class="canvas-rectangle-resize-handle"
      type="button"
      aria-label="Resize card"
      title="Drag to resize · Arrow keys resize"
      onpointerdown={startResize}
      onpointermove={continueResize}
      onpointerup={finishResize}
      onpointercancel={cancelResize}
      onlostpointercapture={cancelResize}
      onkeydown={resizeWithKeyboard}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m5 12 7-7M8 12l4-4M11 12l1-1" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .canvas-rectangle-shell {
    position: absolute;
    pointer-events: none;
  }

  :global(.global-rectangle),
  :global(.nested-rectangle) {
    position: absolute;
    inset: 0;
    display: block;
    box-sizing: border-box;
    padding: 0;
    cursor: move;
    pointer-events: auto;
    touch-action: none;
  }

  :global(.global-rectangle) {
    box-shadow: 0 7px 18px rgb(42 72 60 / 9%);
  }

  :global(.nested-rectangle) {
    box-shadow: 0 5px 14px rgb(42 72 60 / 8%);
  }

  :global(.global-rectangle--selected),
  :global(.nested-rectangle--selected) {
    outline: 2px solid rgb(47 117 96 / 46%);
    outline-offset: 3px;
  }

  :global(.global-rectangle--moving-source) {
    opacity: 0;
  }

  .canvas-rectangle-resize-handle {
    position: absolute;
    right: 3px;
    bottom: 3px;
    z-index: 8;
    display: grid;
    width: 24px;
    height: 24px;
    padding: 0;
    color: #6e8f84;
    background: rgb(250 252 250 / 90%);
    border: 1px solid rgb(151 179 168 / 72%);
    border-radius: 7px 0 10px;
    cursor: nwse-resize;
    place-items: center;
    pointer-events: auto;
    touch-action: none;
  }

  .canvas-rectangle-resize-handle:hover {
    color: #2f6f5e;
    background: #e7f1ed;
    border-color: #73a492;
  }

  .canvas-rectangle-resize-handle:focus-visible {
    outline: 2px solid rgb(55 117 102 / 38%);
    outline-offset: 2px;
  }

  .canvas-rectangle-resize-handle svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.35;
  }

  @media (prefers-reduced-motion: reduce) {
    .canvas-rectangle-resize-handle { transition: none; }
  }
</style>
