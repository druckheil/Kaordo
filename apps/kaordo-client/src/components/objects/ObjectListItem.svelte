<script lang="ts">
  import type { ObjectSummary } from '../../lib/domain/workspace';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import { openContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    canvas: CanvasService;
    dragging: boolean;
    object: ObjectSummary;
    placed: boolean;
  };

  let { canvas, dragging, object, placed }: Props = $props();
</script>

<li class:object-list-item--placed={placed}>
  <button
    class="object-source"
    class:object-source--dragging={dragging}
    type="button"
    aria-label={placed
      ? `Focus ${object.title} on canvas`
      : `Place ${object.title} on canvas`}
    title="Drag to canvas · Press Enter to place"
    onclick={() => canvas.handleObjectSourceClick(object)}
    oncontextmenu={(event) => openContextMenu(event, object.title, [
      {
        action: () => canvas.handleObjectSourceClick(object),
        icon: placed ? 'focus' : 'open',
        id: placed ? 'focus-object' : 'place-object',
        label: placed ? 'Focus on Canvas' : 'Place on Canvas',
      },
      {
        action: async () => {
          await canvas.deleteWorkspaceObject(
            canvas.currentWorkspaceId(),
            object.id,
          );
        },
        confirmation: `Delete ${object.title}?`,
        danger: true,
        icon: 'delete',
        id: 'delete-object',
        label: 'Delete Object',
      },
    ])}
    onkeydown={(event) => canvas.handleObjectSourceKeydown(event, object)}
    onpointerdown={(event) => canvas.startObjectPointerDrag(event, object)}
    onpointermove={(event) => canvas.continueObjectPointerDrag(event)}
    onpointerup={(event) => canvas.finishObjectPointerDrag(event)}
    onpointercancel={(event) => canvas.cancelObjectPointerDrag(event)}
    onlostpointercapture={(event) => canvas.handleObjectPointerCaptureLost(event)}
  >
    <span class="object-mark" aria-hidden="true"></span>
    <span class="object-copy">
      <strong>{object.title}</strong>
      <small>{object.type}</small>
    </span>
    {#if placed}
      <span class="object-placed-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16" role="presentation">
          <path d="m4 8 2.4 2.4L12 5" />
        </svg>
      </span>
    {:else}
      <span class="object-drag-handle" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
    {/if}
  </button>
</li>

<style>
  li {
    min-height: 48px;
    border-bottom: 1px solid rgb(203 208 201 / 64%);
  }

  .object-source {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) 14px;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 47px;
    padding: 7px 8px;
    color: #3c453f;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: grab;
    touch-action: none;
    text-align: left;
    user-select: none;
    -webkit-user-drag: none;
    transition:
      color 160ms ease,
      background-color 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease,
      opacity 160ms ease,
      transform 160ms ease;
  }

  .object-source:hover {
    color: #285a4e;
    background: rgb(255 255 255 / 70%);
    border-color: #d5ded8;
    box-shadow: 0 4px 12px rgb(40 68 57 / 5%);
    transform: translateX(-2px);
  }

  .object-source:active {
    cursor: grabbing;
  }

  .object-source:focus-visible {
    outline: 2px solid rgb(55 117 102 / 38%);
    outline-offset: 1px;
  }

  .object-source--dragging {
    opacity: 0.46;
  }

  .object-list-item--placed .object-source {
    background: rgb(223 236 231 / 42%);
  }

  .object-mark {
    width: 8px;
    height: 8px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 3px;
  }

  .object-copy {
    display: block;
    min-width: 0;
  }

  strong {
    display: block;
    overflow: hidden;
    font-size: calc(12px * var(--text-scale));
    font-weight: 640;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    display: block;
    margin-top: 3px;
    color: #747d76;
    font-size: calc(10px * var(--text-scale));
    line-height: 1.2;
  }

  .object-drag-handle {
    display: grid;
    grid-template-columns: repeat(2, 2px);
    gap: 3px;
    justify-self: end;
    padding: 2px;
    color: #a3aaa5;
  }

  .object-drag-handle i {
    width: 2px;
    height: 2px;
    background: currentColor;
    border-radius: 50%;
  }

  .object-placed-mark {
    display: grid;
    justify-self: end;
    width: 16px;
    height: 16px;
    color: #377566;
    background: #d8e9e2;
    border-radius: 50%;
    place-items: center;
  }

  .object-placed-mark svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  @media (prefers-reduced-motion: reduce) {
    .object-source {
      transition: none;
    }
  }
</style>
