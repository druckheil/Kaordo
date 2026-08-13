<script lang="ts">
  import type { WorkspaceDetail } from '../lib/domain/workspace';
  import type { CanvasService } from '../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../lib/states/CanvasGState';
  import ObjectListItem from './objects/ObjectListItem.svelte';
  import TextObjectListItem from './objects/TextObjectListItem.svelte';
  import PanelHeader from './ui/PanelHeader.svelte';
  import PanelLoading from './ui/PanelLoading.svelte';

  type Props = {
    canvas: CanvasService;
    canvasSnapshot: Readonly<CanvasSnapshot>;
    isOpening: boolean;
    onNewObject: () => void | Promise<void>;
    openError: string | null;
    workspace: WorkspaceDetail | null;
  };

  let {
    canvas,
    canvasSnapshot,
    isOpening,
    onNewObject,
    openError,
    workspace,
  }: Props = $props();
  let newObjectButton = $state<HTMLButtonElement>();
  let placedObjectIds = $derived(
    new Set(
      workspace
        ? (canvasSnapshot.placements[workspace.id] ?? []).map(
            (placement) => placement.id,
          )
        : [],
    ),
  );
  let textElements = $derived(
    workspace
      ? (canvasSnapshot.canvasDocuments[workspace.id]?.elements ?? []).filter(
          (element) => element.type === 'text',
        )
      : [],
  );

  export function focusNewObject() {
    newObjectButton?.focus();
  }
</script>

{#snippet headerAction()}
  {#if workspace && !isOpening}
    <button
      class="new-object-action"
      type="button"
      bind:this={newObjectButton}
      onclick={onNewObject}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 4v12M4 10h12" />
      </svg>
      New Object
    </button>
  {/if}
{/snippet}

<aside
  class="panel objects-panel"
  aria-labelledby="objects-title"
>
  <PanelHeader
    action={headerAction}
    eyebrow="Contents"
    title="Objects"
    titleId="objects-title"
  />

  {#if isOpening}
    <PanelLoading message="Loading objects…" />
  {:else if workspace && (workspace.objects.length || textElements.length)}
    <ul class="object-list" aria-label="Objects in this workspace">
      {#each workspace.objects as object (object.id)}
        <ObjectListItem
          {canvas}
          dragging={canvasSnapshot.draggingObjectId === object.id}
          {object}
          placed={placedObjectIds.has(object.id)}
        />
      {/each}
      {#each textElements as element (element.id)}
        <TextObjectListItem
          {canvas}
          {element}
          selected={canvasSnapshot.selectedGlobalElementId === element.id}
          workspaceId={workspace.id}
        />
      {/each}
    </ul>
  {:else}
    <div class="panel-empty panel-empty--objects">
      <span class="empty-icon empty-icon--objects" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
      <p>{openError ? 'Objects are unavailable.' : 'No objects yet.'}</p>
    </div>
  {/if}
</aside>

<style>
  .panel {
    display: grid;
    grid-template-rows: 64px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--panel);
  }

  .objects-panel {
    border-left: 1px solid var(--line);
  }

  .object-list {
    min-height: 0;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    list-style: none;
  }

  .panel-empty {
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
    padding: 30px 28px;
    color: #68716b;
    text-align: center;
  }

  .panel-empty p {
    max-width: 160px;
    font-size: calc(12px * var(--text-scale));
    line-height: 1.55;
  }

  .empty-icon {
    position: relative;
    display: block;
    width: 38px;
    height: 38px;
    color: #a8aea9;
  }

  .empty-icon--objects {
    display: grid;
    align-content: center;
    gap: 6px;
    padding: 7px 5px;
    border: 1px solid currentColor;
    border-radius: 6px;
  }

  .empty-icon--objects span {
    display: block;
    width: 100%;
    height: 1px;
    background: currentColor;
  }

  .empty-icon--objects span:nth-child(2) {
    width: 68%;
  }

  .new-object-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    gap: 4px;
    height: 30px;
    padding: 0 9px;
    color: #2f675a;
    background: #f7faf8;
    border: 1px solid #b9cec6;
    border-radius: 7px;
    cursor: pointer;
    font-size: calc(10px * var(--text-scale));
    font-weight: 670;
  }

  .new-object-action:hover {
    color: #285a4e;
    background: #eaf3ef;
    border-color: #94b8aa;
  }

  .new-object-action:focus-visible {
    outline: 2px solid rgb(55 117 102 / 35%);
    outline-offset: 2px;
  }

  .new-object-action svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.8;
  }
</style>
