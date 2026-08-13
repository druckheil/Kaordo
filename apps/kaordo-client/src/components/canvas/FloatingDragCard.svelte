<script lang="ts">
  import type { ObjectSummary } from '../../lib/domain/workspace';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import { CANVAS_CARD_HEIGHT, CANVAS_CARD_WIDTH } from '../../lib/features/canvas';
  import CanvasCardContent from './CanvasCardContent.svelte';
  import './canvas-card.css';

  type Props = {
    canvas: CanvasService;
    object: ObjectSummary;
    overCanvas: boolean;
  };

  let { canvas, object, overCanvas }: Props = $props();
  let width = $derived(object.document.frame?.width ?? CANVAS_CARD_WIDTH);
  let height = $derived(object.document.frame?.height ?? CANVAS_CARD_HEIGHT);
  function attachFloatingCard(node: HTMLDivElement) {
    canvas.attachFloatingCard(node);
    return { destroy: () => canvas.attachFloatingCard(null) };
  }
</script>

<div
  class="canvas-card object-drag-card"
  class:object-drag-card--over-canvas={overCanvas}
  use:attachFloatingCard
  aria-hidden="true"
  style={`width: ${width}px; height: ${height}px;`}
>
  <div class="canvas-card-drag-handle">
    <CanvasCardContent {object} />
  </div>
  <div class="object-drag-card-body" aria-hidden="true"></div>
</div>
