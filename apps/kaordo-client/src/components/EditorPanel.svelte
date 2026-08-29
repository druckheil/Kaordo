<script lang="ts">
  import type { CanvasService } from '../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../lib/states/CanvasGState';
  import type { WorkspaceSummary } from '../lib/domain/workspace';
  import type { WorkspaceSnapshot } from '../lib/states/WorkspaceGState';
  import EditorEmptyState from './EditorEmptyState.svelte';
  import KnowledgeCanvas from './canvas/KnowledgeCanvas.svelte';

  type FocusableEditorEmptyState = {
    focusCreateWorkspace(): void;
    focusRetry(): void;
  };

  type Props = {
    activeFile: WorkspaceSummary | null;
    canvas: CanvasService;
    canvasSnapshot: Readonly<CanvasSnapshot>;
    fileCount: number;
    onBack: () => void | Promise<void>;
    onCreateWorkspace: () => void | Promise<void>;
    onRetryOpen: () => void | Promise<void>;
    platform: 'desktop' | 'web';
    storageLocation: string;
    workspaceSnapshot: Readonly<WorkspaceSnapshot>;
  };

  let {
    activeFile,
    canvas,
    canvasSnapshot,
    fileCount,
    onBack,
    onCreateWorkspace,
    onRetryOpen,
    platform,
    storageLocation,
    workspaceSnapshot,
  }: Props = $props();
  let emptyState = $state<FocusableEditorEmptyState>();
  let backButtonElement = $state<HTMLButtonElement>();

  export function focusBack() {
    backButtonElement?.focus();
  }

  export function focusRetry() {
    emptyState?.focusRetry();
  }

  export function focusCreateWorkspace() {
    emptyState?.focusCreateWorkspace();
  }
</script>

<section class="editor-panel" aria-labelledby="editor-title">
  <header class="editor-heading">
    <div class="editor-heading__navigation">
      {#if activeFile}
        <button
          class="editor-back-action"
          type="button"
          bind:this={backButtonElement}
          onclick={onBack}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m11.5 5-5 5 5 5M7 10h7" />
          </svg>
          Back
        </button>
        <span class="editor-heading__separator" aria-hidden="true"></span>
        <span class="editor-file-name" title={`${activeFile.name}.vdw`}>
          {activeFile.name}.vdw
        </span>
      {/if}
    </div>
    <div class="editor-heading__title">
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
    grid-template-rows: 48px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background:
      radial-gradient(circle at center, rgb(55 117 102 / 3%), transparent 34%),
      var(--canvas);
  }

  .editor-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    padding: 0 18px;
    border-bottom: 1px solid var(--line);
  }

  .editor-heading__navigation,
  .editor-heading__title {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .editor-heading__navigation {
    justify-self: start;
    justify-content: flex-start;
    gap: 8px;
  }

  .editor-heading__title {
    justify-self: center;
    justify-content: center;
    gap: 8px;
  }

  .editor-heading__title .panel-eyebrow {
    flex: none;
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
    margin: 0;
    color: #222925;
    font-size: calc(18px * var(--text-scale));
    font-weight: 640;
    letter-spacing: -0.018em;
    line-height: 1;
  }

  .editor-heading__separator {
    flex: none;
    width: 1px;
    height: 18px;
    background: var(--line);
  }

  .editor-file-name {
    min-width: 0;
    overflow: hidden;
    color: #53655c;
    font-size: calc(12px * var(--text-scale));
    font-weight: 620;
    letter-spacing: 0.02em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-back-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 30px;
    padding: 0 10px 0 7px;
    color: #63776d;
    background: var(--canvas);
    border: 0;
    border-radius: 9px;
    box-shadow: 2px 2px 6px rgb(184 192 204 / 54%), -2px -2px 6px rgb(255 255 255 / 70%);
    cursor: pointer;
    font-size: calc(10px * var(--text-scale));
    font-weight: 650;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .editor-back-action:hover {
    color: var(--accent);
    transform: translateY(-1px);
  }

  .editor-back-action:active {
    box-shadow: inset 2px 2px 5px rgb(184 192 204 / 62%);
    transform: translateY(0);
  }

  .editor-back-action:focus-visible {
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  .editor-back-action svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .draft-indicator {
    justify-self: end;
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
