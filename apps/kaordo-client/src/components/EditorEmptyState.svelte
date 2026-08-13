<script lang="ts">
  import type { WorkspaceSnapshot } from '../lib/states/WorkspaceGState';
  import LoadingSpinner from './ui/LoadingSpinner.svelte';

  type Props = {
    fileCount: number;
    onCreateWorkspace: () => void | Promise<void>;
    onRetryOpen: () => void | Promise<void>;
    platform: 'desktop' | 'web';
    storageLocation: string;
    workspaceSnapshot: Readonly<WorkspaceSnapshot>;
  };

  let {
    fileCount,
    onCreateWorkspace,
    onRetryOpen,
    platform,
    storageLocation,
    workspaceSnapshot,
  }: Props = $props();
  let retryButton = $state<HTMLButtonElement>();
  let createWorkspaceButton = $state<HTMLButtonElement>();

  export function focusRetry() {
    retryButton?.focus();
  }

  export function focusCreateWorkspace() {
    createWorkspaceButton?.focus();
  }
</script>

<div
  class="editor-empty"
  aria-busy={workspaceSnapshot.isCreatingWorkspace ||
    workspaceSnapshot.libraryPhase === 'loading' ||
    workspaceSnapshot.openPhase === 'opening'}
>
  <div class="dimension-mark" aria-hidden="true">
    <span class="dimension-plane dimension-plane--back"></span>
    <span class="dimension-plane dimension-plane--middle"></span>
    <span class="dimension-plane dimension-plane--front"></span>
    <span class="dimension-core"></span>
  </div>
  {#if workspaceSnapshot.openPhase === 'opening'}
    <span class="empty-eyebrow">Workspace</span>
    <h3>Opening workspace</h3>
    <p>Reading objects from {workspaceSnapshot.opening?.name}.vdw.</p>
    <span class="workspace-loader" role="status">
      <LoadingSpinner compact />
      Loading workspace…
    </span>
  {:else if workspaceSnapshot.openError}
    <span class="empty-eyebrow">Workspace unavailable</span>
    <h3>Workspace could not be opened</h3>
    <p class="workspace-error" role="alert">{workspaceSnapshot.openError}</p>
    <button
      class="primary-action"
      type="button"
      bind:this={retryButton}
      onclick={onRetryOpen}
    >
      Retry
    </button>
  {:else}
    {#if workspaceSnapshot.libraryPhase === 'loading'}
      <span class="empty-eyebrow">Workspace library</span>
      <h3>Loading workspaces</h3>
      <p>Reading your files from {storageLocation}.</p>
    {:else if fileCount > 0}
      <span class="empty-eyebrow">Workspace library</span>
      <h3>Select a workspace</h3>
      <p>Choose a file from Files to continue, or create another workspace.</p>
    {:else}
      <span class="empty-eyebrow">Local-first workspace</span>
      <h3>{platform === 'desktop' ? 'Create a workspace' : 'Create a browser workspace'}</h3>
      {#if platform === 'desktop'}
        <p>
          Create a portable <strong>.vdw</strong> workspace for your knowledge.
        </p>
      {:else}
        <p>Keep a local workspace in this browser.</p>
      {/if}
    {/if}
    {#if workspaceSnapshot.libraryPhase !== 'loading'}
      <button
        class="primary-action"
        type="button"
        bind:this={createWorkspaceButton}
        onclick={onCreateWorkspace}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 4v12M4 10h12" />
        </svg>
        Create Workspace
      </button>
    {/if}
  {/if}
</div>

<style>
  .editor-empty {
    display: flex;
    align-items: center;
    align-self: center;
    flex-direction: column;
    justify-self: center;
    padding: 48px;
    text-align: center;
  }

  .dimension-mark {
    position: relative;
    width: 92px;
    height: 92px;
    margin-bottom: 28px;
  }

  .dimension-plane {
    position: absolute;
    width: 48px;
    height: 48px;
    border: 1px solid var(--accent);
    border-radius: 13px;
    transform: rotate(45deg);
  }

  .dimension-plane--back {
    top: 8px;
    left: 8px;
    opacity: 0.22;
  }

  .dimension-plane--middle {
    top: 20px;
    left: 20px;
    opacity: 0.48;
  }

  .dimension-plane--front {
    top: 32px;
    left: 32px;
    background: rgb(223 236 231 / 46%);
    border-color: #4c8d7c;
    box-shadow: 0 10px 24px rgb(40 79 68 / 8%);
  }

  .dimension-core {
    position: absolute;
    top: 47px;
    left: 47px;
    z-index: 1;
    width: 14px;
    height: 14px;
    background: var(--accent);
    border: 4px solid var(--canvas);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--accent);
  }

  .empty-eyebrow {
    display: block;
    margin-bottom: 10px;
    color: var(--accent);
    font-size: calc(10px * var(--text-scale));
    font-weight: 700;
    letter-spacing: 0.13em;
    line-height: 1;
    text-transform: uppercase;
  }

  h3 {
    color: #27302b;
    font-size: clamp(
      calc(24px * var(--text-scale)),
      calc(2vw * var(--text-scale)),
      calc(30px * var(--text-scale))
    );
    font-weight: 610;
    letter-spacing: -0.035em;
    line-height: 1.1;
  }

  p {
    max-width: 380px;
    margin-top: 12px;
    color: #68716b;
    font-size: calc(13px * var(--text-scale));
    line-height: 1.55;
  }

  strong {
    color: #46504a;
    font-weight: 650;
  }

  .primary-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 158px;
    height: 38px;
    margin-top: 24px;
    padding: 0 16px;
    color: #f8fbf9;
    background: var(--accent);
    border: 1px solid #2f675a;
    border-radius: 9px;
    box-shadow: 0 5px 14px rgb(39 82 71 / 14%);
    cursor: pointer;
    font-size: calc(12px * var(--text-scale));
    font-weight: 650;
    transition:
      background-color 140ms ease,
      box-shadow 140ms ease,
      transform 140ms ease;
  }

  .primary-action svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.8;
  }

  .primary-action:hover:not(:disabled) {
    background: #2f6b5d;
    box-shadow: 0 7px 18px rgb(39 82 71 / 18%);
    transform: translateY(-1px);
  }

  .primary-action:active:not(:disabled) {
    box-shadow: 0 3px 9px rgb(39 82 71 / 12%);
    transform: translateY(0);
  }

  .primary-action:focus-visible {
    outline: 3px solid rgb(82 145 128 / 28%);
    outline-offset: 3px;
  }

  .primary-action:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  .workspace-error {
    max-width: 420px;
    margin-top: 14px;
    color: #9a3e3e;
    font-size: calc(12px * var(--text-scale));
  }

  .workspace-loader {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    margin-top: 20px;
    color: #657069;
    font-size: calc(11px * var(--text-scale));
    font-weight: 600;
  }

  @media (prefers-reduced-motion: reduce) {
    .primary-action {
      animation: none;
      transition: none;
    }
  }
</style>
