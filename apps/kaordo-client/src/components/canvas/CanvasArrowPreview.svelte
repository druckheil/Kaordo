<script lang="ts">
  import {
    arrowBounds,
    arrowPath,
    type ArrowPoint,
  } from '../../lib/features/arrowGeometry';

  type Props = {
    end: ArrowPoint;
    id: string;
    start: ArrowPoint;
    stroke: string;
  };

  let { end, id, start, stroke }: Props = $props();
  let points = $derived({ end, start });
  let bounds = $derived(arrowBounds(points, 14));
  let markerId = $derived(`explanation-arrow-head-${id}`);
  let path = $derived(arrowPath(start, end, bounds));
</script>

<svg
  class="canvas-arrow-preview"
  aria-hidden="true"
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
      orient="auto"
      refX="5"
      refY="3"
      viewBox="0 0 6 6"
    >
      <path d="M0 0 6 3 0 6Z" fill={stroke}></path>
    </marker>
  </defs>
  <path
    d={path}
    fill="none"
    marker-end={`url(#${markerId})`}
    stroke={stroke}
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2.5"
  ></path>
</svg>

<style>
  .canvas-arrow-preview {
    position: absolute;
    z-index: 25;
    display: block;
    overflow: visible;
    pointer-events: none;
    opacity: .82;
    touch-action: none;
  }
</style>
