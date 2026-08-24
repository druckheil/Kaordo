<script lang="ts">
  import type { CanvasSnapshot } from '../../lib/states/CanvasGState';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import type { WorkspaceDetail } from '../../lib/domain/workspace';
  import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../lib/features/canvas';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import CanvasCard from './CanvasCard.svelte';
  import CanvasOnboarding from './CanvasOnboarding.svelte';
  import CanvasToolbar from './CanvasToolbar.svelte';
  import GlobalCanvasElements from './GlobalCanvasElements.svelte';

  type Props = {
    canvas: CanvasService;
    snapshot: Readonly<CanvasSnapshot>;
    workspace: WorkspaceDetail;
  };

  let { canvas, snapshot, workspace }: Props = $props();
  let placements = $derived(snapshot.placements[workspace.id] ?? []);
  let zoom = $derived(snapshot.zooms[workspace.id] ?? 1);
  let canvasElementCount = $derived(
    snapshot.canvasDocuments[workspace.id]?.elements.length ?? 0,
  );

  function attachViewport(node: HTMLDivElement) {
    canvas.attachViewport(node);
    return { destroy: () => canvas.attachViewport(null) };
  }

  function skippedPanelMessage(count: number): string {
    return count === 1
      ? '1 panel could not be loaded.'
      : `${count} panels could not be loaded.`;
  }
</script>

<div class="canvas-stage">
  <CanvasToolbar
    {canvas}
    placedCount={placements.length}
    {snapshot}
    workspaceId={workspace.id}
  />

  <div
    class="canvas-viewport"
    class:canvas-viewport--drop-target={snapshot.isDropTarget}
    class:canvas-viewport--panning={snapshot.isPanning}
    class:canvas-viewport--camera-pending={!snapshot.isCameraReady}
    use:attachViewport
    role="region"
    aria-label="Knowledge canvas"
    aria-describedby="canvas-instructions"
    onpointerdown={(event) => {
      if (!(event.target as Element | null)?.closest?.('.canvas-card')) {
        canvas.state.selectCard(null);
      }
      canvas.startCanvasPan(event);
    }}
    onpointermove={(event) => canvas.continueCanvasPan(event)}
    onpointerup={(event) => canvas.finishCanvasPan(event)}
    onpointercancel={(event) => canvas.finishCanvasPan(event)}
    onlostpointercapture={(event) => canvas.handleCanvasPanCaptureLost(event)}
    onscroll={() => canvas.handleCanvasScroll()}
    onwheel={(event) => canvas.handleCanvasWheel(event)}
    oncontextmenu={(event) => openContextMenu(event, 'Canvas', [
      {
        action: () => canvas.state.setTool('select'),
        icon: 'select',
        id: 'select-tool',
        label: 'Select Tool',
      },
      {
        action: () => canvas.state.setTool('rectangle'),
        icon: 'rectangle',
        id: 'rectangle-tool',
        label: 'Card Tool',
      },
      {
        action: () => canvas.state.setTool('arrow'),
        icon: 'arrow',
        id: 'arrow-tool',
        label: 'Arrow Tool',
      },
      {
        action: () => canvas.state.setTool('text'),
        icon: 'text',
        id: 'text-tool',
        label: 'Text Tool',
      },
    ])}
  >
    <div
      class="canvas-zoom-space"
      style={`width: ${CANVAS_WIDTH * zoom}px; height: ${CANVAS_HEIGHT * zoom}px;`}
    >
      <div
        class="canvas-surface"
        style={`width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; transform: scale(${zoom});`}
      >
        <GlobalCanvasElements
          {canvas}
          document={snapshot.canvasDocuments[workspace.id] ?? {
            elements: [],
            placements: [],
            version: 1,
          }}
          {snapshot}
          workspaceId={workspace.id}
        />
        <span
          class="canvas-origin"
          style={`left: ${CANVAS_WIDTH / 2}px; top: ${CANVAS_HEIGHT / 2}px;`}
          aria-hidden="true"
        >
          <span></span>
        </span>
        {#each placements as placement (placement.id)}
          <CanvasCard
            {canvas}
            {placement}
            {snapshot}
            workspaceId={workspace.id}
            entering={canvas.state.isEntering(workspace.id, placement.id)}
          />
        {/each}
      </div>
    </div>
  </div>

  {#if placements.length === 0 && canvasElementCount === 0}
    <CanvasOnboarding />
  {/if}

  <div class="canvas-hint" aria-hidden="true">
    <svg viewBox="0 0 20 20" role="presentation">
      <path d="M10 3v14M3 10h14M10 3 8 5m2-2 2 2M10 17l-2-2m2 2 2-2M3 10l2-2m-2 2 2 2m12-2-2-2m2 2-2 2" />
    </svg>
    Drag or two-finger scroll to pan · Wheel or pinch to zoom
  </div>

  {#if workspace.warnings.length}
    <p
      class="canvas-warning"
      role="status"
      title={workspace.warnings.join('\n')}
    >
      {skippedPanelMessage(workspace.warnings.length)}
    </p>
  {:else if workspace.warning}
    <p class="canvas-warning" role="status">{workspace.warning}</p>
  {/if}

  <p id="canvas-instructions" class="visually-hidden">
    Select a panel from Contents to place it on this scrollable canvas. Use an
    panel's Place button for keyboard access, then use arrow keys to move it.
    Use the mouse wheel or pinch to zoom around the pointer position.
  </p>
  <p class="visually-hidden" role="status" aria-live="polite">
    {snapshot.announcement}
  </p>
</div>

<style>
  .canvas-stage {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    isolation: isolate;
    background: #f7f9f6;
  }

  .canvas-viewport {
    position: absolute;
    inset: 0;
    overflow: scroll;
    color: #303934;
    background: #f7f9f6;
    cursor: grab;
    outline: none;
    overscroll-behavior: contain;
    touch-action: none;
    scrollbar-color: #aab8b0 #edf1ed;
    scrollbar-width: thin;
    transition:
      background-color 220ms ease,
      box-shadow 220ms ease;
  }

  .canvas-viewport:focus-visible {
    box-shadow: inset 0 0 0 3px rgb(55 117 102 / 24%);
  }

  .canvas-viewport--panning {
    cursor: grabbing;
    scroll-behavior: auto;
    user-select: none;
  }

  .canvas-viewport--drop-target {
    background: #f0f7f3;
    box-shadow: inset 0 0 0 2px rgb(55 117 102 / 34%);
  }

  .canvas-viewport::-webkit-scrollbar {
    width: 11px;
    height: 11px;
  }

  .canvas-viewport::-webkit-scrollbar-track {
    background: #edf1ed;
    border: 3px solid #f7f9f6;
    border-radius: 999px;
  }

  .canvas-viewport::-webkit-scrollbar-thumb {
    background: #aab8b0;
    border: 3px solid #edf1ed;
    border-radius: 999px;
  }

  .canvas-viewport::-webkit-scrollbar-corner {
    background: #f7f9f6;
  }

  .canvas-surface {
    position: relative;
    overflow: hidden;
    background-color: #f8faf7;
    background-image:
      linear-gradient(rgb(55 117 102 / 3.5%) 1px, transparent 1px),
      linear-gradient(90deg, rgb(55 117 102 / 3.5%) 1px, transparent 1px),
      radial-gradient(circle at 1px 1px, rgb(67 104 91 / 24%) 1.1px, transparent 1.2px),
      radial-gradient(circle at 50% 50%, rgb(126 181 164 / 10%), transparent 34%);
    background-position: 0 0, 0 0, 0 0, 0 0;
    background-size: 120px 120px, 120px 120px, 24px 24px, 100% 100%;
    box-shadow: inset 0 0 120px rgb(51 82 69 / 2%);
    transform-origin: top left;
    will-change: transform;
  }

  .canvas-zoom-space {
    position: relative;
    overflow: visible;
  }

  .canvas-viewport--camera-pending .canvas-surface {
    opacity: 0;
  }

  .canvas-hint,
  .canvas-warning {
    position: absolute;
    z-index: 4;
    backdrop-filter: blur(12px);
    box-shadow:
      0 8px 24px rgb(35 57 48 / 8%),
      inset 0 1px rgb(255 255 255 / 82%);
    pointer-events: none;
  }

  .canvas-hint {
    bottom: 15px;
    left: 16px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 29px;
    padding: 0 10px;
    color: #707a74;
    background: rgb(250 252 249 / 78%);
    border: 1px solid rgb(202 212 205 / 70%);
    border-radius: 8px;
    font-size: calc(9px * var(--text-scale));
    font-weight: 620;
    animation: canvas-overlay-enter 340ms 80ms ease-out both;
  }

  .canvas-hint svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: #568879;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.25;
  }

  .canvas-warning {
    right: 16px;
    bottom: 15px;
    max-width: 320px;
    padding: 8px 11px;
    color: #805d24;
    background: rgb(250 243 229 / 90%);
    border: 1px solid rgb(234 217 185 / 90%);
    border-radius: 8px;
    font-size: calc(10px * var(--text-scale));
    line-height: 1.4;
  }

  .canvas-origin {
    position: absolute;
    width: 17px;
    height: 17px;
    color: rgb(55 117 102 / 28%);
    border: 1px solid currentColor;
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  .canvas-origin::before,
  .canvas-origin::after {
    position: absolute;
    top: 7px;
    left: -8px;
    width: 31px;
    height: 1px;
    background: currentColor;
    content: "";
  }

  .canvas-origin::after {
    transform: rotate(90deg);
  }

  .canvas-origin span {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 3px;
    height: 3px;
    background: currentColor;
    border-radius: 50%;
  }

  @keyframes canvas-overlay-enter {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .canvas-hint {
      animation: none;
    }

    .canvas-viewport,
    .canvas-surface {
      transition: none;
    }

    .canvas-viewport {
      scroll-behavior: auto;
    }
  }
</style>
