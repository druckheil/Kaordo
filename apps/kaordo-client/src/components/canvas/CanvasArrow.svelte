<script lang="ts">
  import { onMount } from 'svelte';
  import type { CanvasPlacement } from '../../lib/domain/canvas';
  import type { ArrowElement, ArrowAttachment, CanvasElement } from '../../lib/domain/workspace';
  import {
    arrowBounds,
    arrowPath,
    arrowPoints,
    type ArrowPoint,
  } from '../../lib/features/arrowGeometry';
  import {
    ARROW_LIVE_DRAG_EVENT,
    type ArrowHandle,
    type ArrowLiveDragDetail,
  } from '../../lib/features/arrowLive';

  type Props = {
    arrow: ArrowElement;
    elements: readonly CanvasElement[];
    onContextMenu: (event: MouseEvent) => void;
    onStartMove: (event: PointerEvent, arrow: ArrowElement) => void;
    onStartPointMove: (event: PointerEvent, arrow: ArrowElement, handle: ArrowHandle) => void;
    placements: readonly CanvasPlacement[];
    selected: boolean;
  };

  let {
    arrow,
    elements,
    onContextMenu,
    onStartMove,
    onStartPointMove,
    placements,
    selected,
  }: Props = $props();
  let liveStartDelta = $state({ deltaX: 0, deltaY: 0 });
  let liveEndDelta = $state({ deltaX: 0, deltaY: 0 });
  let liveControlDeltas = $state<Record<number, { deltaX: number; deltaY: number }>>({});
  let pendingLiveDrags = new Map<string, ArrowLiveDragDetail>();
  let liveFrame: number | null = null;
  let points = $derived.by(() => {
    const base = arrowPoints(arrow, elements, placements);
    return {
      end: {
        x: base.end.x + liveEndDelta.deltaX,
        y: base.end.y + liveEndDelta.deltaY,
      },
      start: {
        x: base.start.x + liveStartDelta.deltaX,
        y: base.start.y + liveStartDelta.deltaY,
      },
      controlPoints: arrow.controlPoints.map((point, index) => ({
        x: point.x + (liveControlDeltas[index]?.deltaX ?? 0),
        y: point.y + (liveControlDeltas[index]?.deltaY ?? 0),
      })),
    };
  });
  let bounds = $derived(arrowBounds(points, 14));
  let markerId = $derived(`arrow-head-${arrow.id}`);
  let dashArray = $derived(
    arrow.lineStyle === 'dashed'
      ? '14 9'
      : arrow.lineStyle === 'dotted'
        ? '2 8'
        : undefined,
  );

  onMount(() => {
    const handleLiveDrag = (event: Event) => {
      const detail = (event as CustomEvent<ArrowLiveDragDetail>).detail;
      if (!detail) return;
      pendingLiveDrags.set(liveDetailKey(detail), detail);
      if (liveFrame !== null) return;
      liveFrame = requestAnimationFrame(() => {
        liveFrame = null;
        const next = [...pendingLiveDrags.values()];
        pendingLiveDrags = new Map();
        for (const drag of next) applyLiveDrag(drag);
      });
    };

    window.addEventListener(ARROW_LIVE_DRAG_EVENT, handleLiveDrag);
    return () => {
      window.removeEventListener(ARROW_LIVE_DRAG_EVENT, handleLiveDrag);
      if (liveFrame !== null) cancelAnimationFrame(liveFrame);
      liveFrame = null;
      pendingLiveDrags.clear();
    };
  });

  function applyLiveDrag(detail: ArrowLiveDragDetail): void {
      if (detail.phase === 'end') {
        if (detail.arrowId === arrow.id && detail.controlPoint !== undefined) {
          const next = { ...liveControlDeltas };
          delete next[detail.controlPoint];
          liveControlDeltas = next;
        } else if (detail.arrowId === arrow.id ||
          matchesAttachment(arrow.startAttachment, detail) ||
          matchesAttachment(arrow.endAttachment, detail)) {
          liveStartDelta = { deltaX: 0, deltaY: 0 };
          liveEndDelta = { deltaX: 0, deltaY: 0 };
          liveControlDeltas = {};
        }
        return;
      }
      if (detail.arrowId === arrow.id && detail.controlPoint !== undefined) {
        liveControlDeltas = {
          ...liveControlDeltas,
          [detail.controlPoint]: { deltaX: detail.deltaX, deltaY: detail.deltaY },
        };
        return;
      }
      if (detail.arrowId === arrow.id && detail.endpoint) {
        const delta = { deltaX: detail.deltaX, deltaY: detail.deltaY };
        if (detail.endpoint === 'start') liveStartDelta = delta;
        else liveEndDelta = delta;
        return;
      }
      liveStartDelta = matchesAttachment(arrow.startAttachment, detail)
        ? { deltaX: detail.deltaX, deltaY: detail.deltaY }
        : { deltaX: 0, deltaY: 0 };
      liveEndDelta = matchesAttachment(arrow.endAttachment, detail)
        ? { deltaX: detail.deltaX, deltaY: detail.deltaY }
        : { deltaX: 0, deltaY: 0 };
  }

  function liveDetailKey(detail: ArrowLiveDragDetail): string {
    if (detail.arrowId) {
      if (detail.controlPoint !== undefined) return `arrow:${detail.arrowId}:control:${detail.controlPoint}`;
      if (detail.endpoint) return `arrow:${detail.arrowId}:endpoint:${detail.endpoint}`;
      return `arrow:${detail.arrowId}`;
    }
    if (detail.elementId) return `element:${detail.elementId}`;
    if (detail.objectId) return `object:${detail.objectId}`;
    return detail.phase;
  }

  function matchesAttachment(
    attachment: ArrowAttachment | undefined,
    detail: ArrowLiveDragDetail,
  ): boolean {
    if (!attachment) return false;
    // Nested arrows already move with their parent panel. Applying the panel
    // delta a second time would make the endpoint jump twice as far.
    if (detail.objectId && arrow.parentObjectId === detail.objectId) return false;
    if (attachment.objectId && attachment.objectId === detail.objectId) return true;
    if (
      attachment.elementId &&
      (attachment.elementId === detail.elementId ||
        detail.elementIds?.includes(attachment.elementId))
    ) return true;
    return Boolean(
      detail.objectId &&
      attachment.elementId &&
      elementBelongsToObject(attachment.elementId, detail.objectId),
    );
  }

  function elementBelongsToObject(elementId: string, objectId: string): boolean {
    const visited = new Set<string>();
    let current = elements.find((element) => element.id === elementId);
    while (current && !visited.has(current.id)) {
      if (current.parentObjectId === objectId) return true;
      visited.add(current.id);
      const parentElementId = 'parentElementId' in current
        ? current.parentElementId
        : undefined;
      if (!parentElementId) return false;
      current = elements.find((element) => element.id === parentElementId);
    }
    return false;
  }

  function path(): string {
    return arrowPath(points.start, points.end, bounds, points.controlPoints);
  }

  function localPoint(point: ArrowPoint): ArrowPoint {
    return { x: point.x - bounds.left, y: point.y - bounds.top };
  }
</script>

<svg
  class="canvas-arrow"
  class:canvas-arrow--selected={selected}
  data-canvas-element-id={arrow.id}
  role="img"
  aria-label="Arrow"
  style={`left:${bounds.left}px;top:${bounds.top}px;width:${Math.max(1, bounds.right - bounds.left)}px;height:${Math.max(1, bounds.bottom - bounds.top)}px`}
  viewBox={`0 0 ${Math.max(1, bounds.right - bounds.left)} ${Math.max(1, bounds.bottom - bounds.top)}`}
  preserveAspectRatio="none"
>
  <defs>
    <marker
      id={markerId}
      markerHeight="6"
      markerUnits="strokeWidth"
      markerWidth="6"
      orient="auto-start-reverse"
      refX="5"
      refY="3"
      viewBox="0 0 6 6"
    >
      <path d="M0 0 6 3 0 6Z" fill={arrow.stroke}></path>
    </marker>
  </defs>
  <path
    class="canvas-arrow-hit"
    d={path()}
    role="presentation"
    oncontextmenu={onContextMenu}
    onpointerdown={(event) => onStartMove(event, arrow)}
  ></path>
  <path
    class="canvas-arrow-line"
    class:canvas-arrow-line--selected={selected}
    d={path()}
    fill="none"
    marker-end={arrow.headMode === 'none' ? undefined : `url(#${markerId})`}
    marker-start={arrow.headMode === 'both' ? `url(#${markerId})` : undefined}
    stroke={arrow.stroke}
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-dasharray={dashArray}
    stroke-width={arrow.strokeWidth}
  ></path>
  {#if selected}
    {@const start = localPoint(points.start)}
    {@const end = localPoint(points.end)}
    <circle
      class="canvas-arrow-handle"
      cx={start.x}
      cy={start.y}
      r="6"
      role="presentation"
      onpointerdown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStartPointMove(event, arrow, 'start');
      }}
    ></circle>
    <circle
      class="canvas-arrow-handle"
      cx={end.x}
      cy={end.y}
      r="6"
      role="presentation"
      onpointerdown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStartPointMove(event, arrow, 'end');
      }}
    ></circle>
    {#each points.controlPoints as controlPoint, index (index)}
      {@const localControlPoint = localPoint(controlPoint)}
      <circle
        class="canvas-arrow-handle canvas-arrow-handle--control"
        cx={localControlPoint.x}
        cy={localControlPoint.y}
        r="5"
        role="presentation"
        onpointerdown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStartPointMove(event, arrow, index);
        }}
      ></circle>
    {/each}
  {/if}
</svg>

<style>
  .canvas-arrow {
    position: absolute;
    z-index: 24;
    display: block;
    overflow: visible;
    pointer-events: none;
    touch-action: none;
  }

  .canvas-arrow-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 16px;
    pointer-events: stroke;
    cursor: grab;
  }

  .canvas-arrow-hit:active { cursor: grabbing; }
  .canvas-arrow-line { opacity: 0.9; pointer-events: none; }
  .canvas-arrow-line--selected { filter: drop-shadow(0 2px 3px rgb(42 72 60 / 18%)); }

  .canvas-arrow-handle {
    fill: #fff;
    stroke: #397565;
    stroke-width: 2;
    cursor: grab;
    pointer-events: auto;
  }

  .canvas-arrow-handle:active { cursor: grabbing; }
  .canvas-arrow-handle--control { fill: #e5f1ec; r: 5px; }

  @media (prefers-reduced-motion: reduce) {
    .canvas-arrow-line { transition: none; }
  }
</style>
