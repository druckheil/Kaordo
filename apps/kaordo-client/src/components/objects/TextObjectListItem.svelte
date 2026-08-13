<script lang="ts">
  import { textElementLabel, type TextElement } from '../../lib/domain/workspace';
  import type { CanvasService } from '../../lib/services/CanvasService';
  import { openContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    canvas: CanvasService;
    element: TextElement;
    selected: boolean;
    workspaceId: string;
  };

  let { canvas, element, selected, workspaceId }: Props = $props();
</script>

<li class:text-object-item--selected={selected}>
  <button
    class="text-object-source"
    type="button"
    aria-label={`Focus text: ${textElementLabel(element)}`}
    title="Focus text on canvas"
    onclick={() => void canvas.focusTextElement(workspaceId, element.id)}
    oncontextmenu={(event) => openContextMenu(event, textElementLabel(element), [
      {
        action: () => canvas.focusTextElement(workspaceId, element.id),
        icon: 'focus',
        id: 'focus-text',
        label: 'Focus on Canvas',
      },
      {
        action: async () => {
          await canvas.focusTextElement(workspaceId, element.id);
          canvas.state.editText(element.id);
        },
        icon: 'edit',
        id: 'edit-text',
        label: 'Edit Text',
      },
      {
        action: () => canvas.deleteCanvasElement(workspaceId, element.id),
        confirmation: 'Delete this text?',
        danger: true,
        icon: 'delete',
        id: 'delete-text',
        label: 'Delete Text',
      },
    ])}
  >
    <span class="text-object-mark" aria-hidden="true">T</span>
    <span class="text-object-copy">
      <strong>{textElementLabel(element)}</strong>
      <small>{element.parentElementId
        ? 'Text · Rectangle'
        : element.parentObjectId
          ? 'Text · Object'
          : 'Text · Canvas'}</small>
    </span>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 4 4 4-4 4" />
    </svg>
  </button>
</li>

<style>
  li {
    min-height: 48px;
    border-bottom: 1px solid rgb(203 208 201 / 64%);
  }

  .text-object-source {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 14px;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 47px;
    padding: 7px 8px;
    color: #3c453f;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
  }

  .text-object-source:hover,
  .text-object-item--selected .text-object-source {
    color: #285a4e;
    background: rgb(223 236 231 / 48%);
    border-color: #d0ddd6;
    transform: translateX(-2px);
  }

  .text-object-source:focus-visible {
    outline: 2px solid rgb(55 117 102 / 38%);
    outline-offset: 1px;
  }

  .text-object-mark {
    display: grid;
    width: 21px;
    height: 21px;
    color: #397565;
    background: #e2eee9;
    border: 1px solid #aac8bc;
    border-radius: 6px;
    font-family: Georgia, serif;
    font-size: calc(12px * var(--text-scale));
    font-weight: 700;
    place-items: center;
  }

  .text-object-copy { min-width: 0; }
  strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: calc(12px * var(--text-scale)); font-weight: 640; line-height: 1.3; }
  small { margin-top: 3px; color: #747d76; font-size: calc(10px * var(--text-scale)); line-height: 1.2; }
  svg { width: 13px; height: 13px; fill: none; stroke: #8a9690; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }

  @media (prefers-reduced-motion: reduce) {
    .text-object-source { transition: none; }
  }
</style>
