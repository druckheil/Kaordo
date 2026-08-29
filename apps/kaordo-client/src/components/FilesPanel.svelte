<script lang="ts">
  import type { WorkspaceSummary } from '../lib/domain/workspace';
  import WorkspaceFileItem from './files/WorkspaceFileItem.svelte';
  import PanelHeader from './ui/PanelHeader.svelte';
  import PanelLoading from './ui/PanelLoading.svelte';

  type FocusablePanelHeader = { focusTitle(): void };

  type Props = {
    files: WorkspaceSummary[];
    activeFileId: string | null;
    loading: boolean;
    error: string | null;
    warnings: string[];
    platform: 'desktop' | 'web';
    onOpen: (file: WorkspaceSummary) => void | Promise<void>;
    onDelete: (file: WorkspaceSummary) => void | Promise<void>;
    onRetry: () => void | Promise<void>;
  };

  let {
    files,
    activeFileId,
    loading,
    error,
    warnings,
    platform,
    onOpen,
    onDelete,
    onRetry,
  }: Props = $props();
  let panelHeader = $state<FocusablePanelHeader>();
  let retryButtonElement = $state<HTMLButtonElement>();

  export function focusTitle() {
    panelHeader?.focusTitle();
  }

  export function focusRetry() {
    retryButtonElement?.focus();
  }

  function skippedWorkspaceMessage(count: number): string {
    return count === 1
      ? '1 workspace file could not be loaded.'
      : `${count} workspace files could not be loaded.`;
  }
</script>

<aside
  id="klaro-workspace-panel"
  class="panel files-panel"
  aria-labelledby="files-title"
  aria-busy={loading}
>
  <PanelHeader
    bind:this={panelHeader}
    eyebrow="Workspace"
    title="Files"
    titleId="files-title"
  />

  {#if loading}
    <PanelLoading message="Loading workspace files…" />
  {:else if files.length > 0}
    <nav class="file-list" aria-label="Workspace files">
      <ul>
        {#each files as file (file.path)}
          <WorkspaceFileItem
            active={activeFileId === file.id}
            {file}
            {onOpen}
            {onDelete}
            {platform}
          />
        {/each}
      </ul>
      {#if warnings.length > 0}
        <p
          class="library-notice"
          role="status"
          title={warnings.join('\n')}
        >
          {skippedWorkspaceMessage(warnings.length)}
        </p>
      {/if}
      {#if error}
        <div class="library-notice library-notice--error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            bind:this={retryButtonElement}
            onclick={onRetry}
          >
            Retry
          </button>
        </div>
      {/if}
    </nav>
  {:else}
    <div class="panel-empty">
      <span class="empty-icon empty-icon--stack" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
      {#if error}
        <p class="library-empty-error" role="alert">{error}</p>
        <button
          class="library-retry"
          type="button"
          bind:this={retryButtonElement}
          onclick={onRetry}
        >
          Retry
        </button>
      {:else}
        <p>Created workspace files will appear here.</p>
      {/if}
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

  .files-panel {
    border-right: 1px solid var(--line);
  }

  .file-list {
    min-height: 0;
    padding: 9px 8px;
    overflow: auto;
  }

  .file-list ul {
    display: grid;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .library-notice {
    margin: 10px 2px 2px;
    padding: 9px 10px;
    color: #755c2e;
    background: #faf3e5;
    border: 1px solid #ead9b9;
    border-radius: 7px;
    font-size: calc(10px * var(--text-scale));
    line-height: 1.45;
  }

  .library-notice--error {
    color: #8f3d3d;
    background: #fbefed;
    border-color: #efd2cd;
  }

  .library-notice--error button,
  .library-retry {
    height: 28px;
    margin-top: 8px;
    padding: 0 10px;
    color: #48524c;
    background: #fff;
    border: 1px solid #c9d0ca;
    border-radius: 6px;
    cursor: pointer;
    font-size: calc(10px * var(--text-scale));
    font-weight: 650;
  }

  .library-notice--error button:hover,
  .library-retry:hover {
    border-color: #9eaaa2;
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

  .panel-empty .library-empty-error {
    max-width: 180px;
    color: #8f3d3d;
  }

  .library-retry {
    margin-top: -4px;
  }

  .empty-icon {
    position: relative;
    display: block;
    width: 38px;
    height: 38px;
    color: #a8aea9;
  }

  .empty-icon--stack span {
    position: absolute;
    left: 6px;
    width: 26px;
    height: 19px;
    background: var(--panel-soft);
    border: 1px solid currentColor;
    border-radius: 4px;
  }

  .empty-icon--stack span:nth-child(1) {
    top: 3px;
    opacity: 0.45;
  }

  .empty-icon--stack span:nth-child(2) {
    top: 9px;
    opacity: 0.72;
  }

  .empty-icon--stack span:nth-child(3) {
    top: 15px;
  }
</style>
