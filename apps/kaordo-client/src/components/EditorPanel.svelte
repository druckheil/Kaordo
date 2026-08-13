<script lang="ts">
  import type { CanvasService } from '../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../lib/states/CanvasGState';
  import type { WorkspaceSnapshot } from '../lib/states/WorkspaceGState';
  import EditorEmptyState from './EditorEmptyState.svelte';
  import KnowledgeCanvas from './canvas/KnowledgeCanvas.svelte';

  type FocusableEditorEmptyState = {
    focusCreateWorkspace(): void;
    focusRetry(): void;
  };

  type Props = {
    canvas: CanvasService;
    canvasSnapshot: Readonly<CanvasSnapshot>;
    fileCount: number;
    onCreateWorkspace: () => void | Promise<void>;
    onRetryOpen: () => void | Promise<void>;
    platform: 'desktop' | 'web';
    storageLocation: string;
    workspaceSnapshot: Readonly<WorkspaceSnapshot>;
  };

  let {
    canvas,
    canvasSnapshot,
    fileCount,
    onCreateWorkspace,
    onRetryOpen,
    platform,
    storageLocation,
    workspaceSnapshot,
  }: Props = $props();
  let emptyState = $state<FocusableEditorEmptyState>();

  export function focusRetry() {
    emptyState?.focusRetry();
  }

  export function focusCreateWorkspace() {
    emptyState?.focusCreateWorkspace();
  }
</script>

<section class="editor-panel" aria-labelledby="editor-title">
  <header class="editor-heading">
    <div>
      <span class="panel-eyebrow">Canvas</span>
      <h2 id="editor-title">Editor</h2>
    </div>
    <span class="draft-indicator">
      <span class="draft-dot" aria-hidden="true"></span>
      Ready
    </span>
  </header>

  {#if workspaceSnapshot.active && workspaceSnapshot.openPhase === 'idle'}
    <KnowledgeCanvas
      canvas={canvas}
      snapshot={canvasSnapshot}
      workspace={workspaceSnapshot.active}
    />
  {:else}
    <EditorEmptyState
      bind:this={emptyState}
      {fileCount}
      {onCreateWorkspace}
      {onRetryOpen}
      {platform}
      {storageLocation}
      {workspaceSnapshot}
    />
  {/if}
</section>

<style>
  .editor-panel {
    display: grid;
    grid-template-rows: 64px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background:
      radial-gradient(circle at center, rgb(55 117 102 / 3%), transparent 34%),
      var(--canvas);
  }

  .editor-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    border-bottom: 1px solid var(--line);
  }

  .panel-eyebrow {
    display: block;
    color: var(--muted);
    font-size: calc(10px * var(--text-scale));
    font-weight: 700;
    letter-spacing: 0.13em;
    line-height: 1;
    text-transform: uppercase;
  }

  .editor-heading h2 {
    margin-top: 7px;
    color: #222925;
    font-size: calc(18px * var(--text-scale));
    font-weight: 640;
    letter-spacing: -0.018em;
    line-height: 1;
  }

  .draft-indicator {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: #6d766f;
    font-size: calc(11px * var(--text-scale));
    font-weight: 560;
  }

  .draft-dot {
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
