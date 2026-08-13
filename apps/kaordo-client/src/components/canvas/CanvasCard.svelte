<script lang="ts">
  import type { CanvasPlacement } from '../../lib/domain/canvas';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import CardNestedCanvas from './CardNestedCanvas.svelte';
  import CanvasCardContent from './CanvasCardContent.svelte';
  import './canvas-card.css';

  type Props = {
    canvas: CanvasService;
    entering: boolean;
    placement: CanvasPlacement;
    snapshot: Readonly<CanvasSnapshot>;
    workspaceId: string;
  };

  let { canvas, entering, placement, snapshot, workspaceId }: Props = $props();
</script>

<article
  class="canvas-card-positioner"
  data-canvas-positioner-id={placement.id}
  style={`width:${placement.width}px;height:${placement.height}px;transform:translate3d(${placement.x}px, ${placement.y}px, 0);`}
>
  <div
    class="canvas-card"
    class:canvas-card--entering={entering}
    class:canvas-card--selected={snapshot.selectedCardId === placement.id}
    role="group"
    aria-roledescription="canvas object"
    data-canvas-object-id={placement.id}
    onanimationend={() => canvas.state.clearEntering(workspaceId, placement.id)}
    oncontextmenu={(event) => openContextMenu(event, placement.title, [
      {
        action: () => canvas.handleObjectSourceClick(placement),
        icon: 'focus',
        id: 'focus-object',
        label: 'Focus Object',
      },
      {
        action: () => canvas.state.setTool('rectangle'),
        icon: 'rectangle',
        id: 'rectangle-tool',
        label: 'Rectangle Tool',
      },
      {
        action: () => canvas.state.setTool('text'),
        icon: 'text',
        id: 'text-tool',
        label: 'Text Tool',
      },
      {
        action: async () => {
          await canvas.deleteWorkspaceObject(workspaceId, placement.id);
        },
        confirmation: `Delete ${placement.title}?`,
        danger: true,
        icon: 'delete',
        id: 'delete-object',
        label: 'Delete Object',
      },
    ])}
  >
    <button
      class="canvas-card-drag-handle"
      type="button"
      aria-label={`${placement.title}, ${placement.type}. Drag or use arrow keys to move.`}
      title="Drag to move · Arrow keys to nudge"
      onpointerdown={(event) => {
        canvas.state.selectCard(placement.id);
        canvas.startObjectPointerDrag(event, placement);
      }}
      onpointermove={(event) => canvas.continueObjectPointerDrag(event)}
      onpointerup={(event) => canvas.finishObjectPointerDrag(event)}
      onpointercancel={(event) => canvas.cancelObjectPointerDrag(event)}
      onlostpointercapture={(event) => canvas.handleObjectPointerCaptureLost(event)}
      onkeydown={(event) => canvas.handleCanvasCardKeydown(event, placement)}
    >
      <CanvasCardContent object={placement} />
    </button>
    <CardNestedCanvas
      {canvas}
      document={snapshot.canvasDocuments[workspaceId] ?? {
        elements: [],
        placements: [],
        version: 1,
      }}
      {placement}
      {snapshot}
      {workspaceId}
    />
    <button
      class="canvas-card-resize-handle"
      class:canvas-card-resize-handle--active={snapshot.resizingObjectId === placement.id}
      type="button"
      aria-label={`Resize ${placement.title}`}
      title="Drag to resize · Arrow keys resize · Shift for larger steps"
      onpointerdown={(event) => canvas.startObjectResize(event, placement)}
      onpointermove={(event) => canvas.continueObjectResize(event)}
      onpointerup={(event) => canvas.finishObjectResize(event)}
      onpointercancel={(event) => canvas.cancelObjectResize(event)}
      onlostpointercapture={(event) => canvas.handleObjectResizeCaptureLost(event)}
      onkeydown={(event) => canvas.handleObjectResizeKeydown(event, placement)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m5 12 7-7M8 12l4-4M11 12l1-1" />
      </svg>
    </button>
  </div>
</article>
