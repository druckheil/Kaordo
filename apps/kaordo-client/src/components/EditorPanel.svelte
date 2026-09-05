<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CanvasService } from '../lib/services/CanvasService';
  import type { CanvasPlacement } from '../lib/domain/canvas';
  import type { WorkspaceSummary } from '../lib/domain/workspace';
  import {
    searchCanvasContent,
    type CanvasSearchHighlight,
    type CanvasSearchResult,
  } from '../lib/features/canvasSearch';
  import type { CanvasSnapshot } from '../lib/states/CanvasGState';
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
    onCreatePanel: () => void | Promise<void>;
    onCreateWorkspace: () => void | Promise<void>;
    onRenamePanel: (panel: CanvasPlacement) => void;
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
    onCreatePanel,
    onCreateWorkspace,
    onRenamePanel,
    onRetryOpen,
    platform,
    storageLocation,
    workspaceSnapshot,
  }: Props = $props();
  let emptyState = $state<FocusableEditorEmptyState>();
  let backButtonElement = $state<HTMLButtonElement>();
  let searchButtonElement = $state<HTMLButtonElement>();
  let createPanelButtonElement = $state<HTMLButtonElement>();
  let searchInputElement = $state<HTMLInputElement>();
  let searchOpen = $state(false);
  let searchQuery = $state('');
  let selectedSearchIndex = $state(0);
  let searchRootElement = $state<HTMLDivElement>();
  let searchHighlightTimer: number | null = null;
  let searchHighlightToken = 0;
  let searchResults = $derived.by(() => {
    const workspace = workspaceSnapshot.active;
    const elements = workspace
      ? canvasSnapshot.canvasDocuments[workspace.id]?.elements ?? []
      : [];
    return searchCanvasContent(workspace, elements, searchQuery);
  });

  export function focusBack() {
    backButtonElement?.focus();
  }

  export function focusRetry() {
    emptyState?.focusRetry();
  }

  export function focusCreateWorkspace() {
    emptyState?.focusCreateWorkspace();
  }

  export function focusCreatePanel() {
    createPanelButtonElement?.focus();
  }

  onDestroy(() => {
    if (searchHighlightTimer !== null) window.clearTimeout(searchHighlightTimer);
    canvas.state.setSearchHighlight(null);
  });

  function toggleSearch(): void {
    if (!activeFile) return;
    if (searchOpen) {
      closeSearch();
      return;
    }
    searchOpen = true;
    selectedSearchIndex = 0;
    void tick().then(() => searchInputElement?.focus());
  }

  function closeSearch(restoreFocus = true): void {
    searchOpen = false;
    searchQuery = '';
    selectedSearchIndex = 0;
    if (restoreFocus) void tick().then(() => searchButtonElement?.focus());
  }

  function handleSearchWindowPointerDown(event: PointerEvent): void {
    if (!searchOpen) return;
    const target = event.target;
    if (target instanceof Node && searchRootElement?.contains(target)) return;
    closeSearch();
  }

  function handleSearchWindowKeydown(event: KeyboardEvent): void {
    if (!searchOpen || event.key !== 'Escape') return;
    event.preventDefault();
    closeSearch();
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === 'ArrowDown') {
      if (!searchResults.length) return;
      event.preventDefault();
      selectedSearchIndex = (selectedSearchIndex + 1) % searchResults.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!searchResults.length) return;
      event.preventDefault();
      selectedSearchIndex = (selectedSearchIndex - 1 + searchResults.length) % searchResults.length;
      return;
    }
    if (event.key === 'Enter') {
      const result = searchResults[selectedSearchIndex];
      if (!result) return;
      event.preventDefault();
      focusSearchResult(result);
    }
  }

  function focusSearchResult(result: CanvasSearchResult): void {
    const workspace = workspaceSnapshot.active;
    if (!workspace) return;
    if (result.kind === 'panel') {
      canvas.handleObjectSourceClick(result.object);
      triggerSearchHighlight({
        id: result.object.id,
        kind: 'panel',
        query: searchQuery.trim(),
      });
      return;
    }
    const parentObjectId = result.element.parentObjectId;
    if (parentObjectId && !canvas.isObjectPlaced(workspace.id, parentObjectId)) {
      const parent = workspace.objects.find((object) => object.id === parentObjectId);
      if (parent) canvas.handleObjectSourceClick(parent);
    }
    void canvas.focusCanvasElement(workspace.id, result.element.id).then(() => {
      if (workspaceSnapshot.active?.id !== workspace.id) return;
      triggerSearchHighlight({
        id: result.element.id,
        kind: 'element',
        query: searchQuery.trim(),
      });
    });
  }

  function triggerSearchHighlight(target: Omit<CanvasSearchHighlight, 'token'>): void {
    const token = ++searchHighlightToken;
    if (searchHighlightTimer !== null) {
      window.clearTimeout(searchHighlightTimer);
      searchHighlightTimer = null;
    }
    canvas.state.setSearchHighlight(null);
    void tick().then(() => {
      if (token !== searchHighlightToken) return;
      canvas.state.setSearchHighlight({ ...target, token });
      searchHighlightTimer = window.setTimeout(() => {
        if (token !== searchHighlightToken) return;
        canvas.state.setSearchHighlight(null);
        searchHighlightTimer = null;
      }, 1_100);
    });
  }

  function handleSearchInput(): void {
    selectedSearchIndex = 0;
  }

  $effect(() => {
    if (!activeFile && searchOpen) closeSearch(false);
  });
</script>

<svelte:window
  onpointerdown={handleSearchWindowPointerDown}
  onkeydown={handleSearchWindowKeydown}
/>

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
    <div class="editor-heading__tools">
      {#if workspaceSnapshot.active && workspaceSnapshot.openPhase === 'idle'}
        <button
          bind:this={createPanelButtonElement}
          class="editor-create-panel"
          type="button"
          aria-label="New Panel"
          title="Create new panel"
          onclick={onCreatePanel}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4v12M4 10h12" />
          </svg>
          <span>New Panel</span>
        </button>
      {/if}
      {#if searchOpen}
        <div class="editor-search" bind:this={searchRootElement}>
          <div class="editor-search__field">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="4.5" />
              <path d="m12 12 4 4" />
            </svg>
            <input
              bind:this={searchInputElement}
              bind:value={searchQuery}
              aria-controls="klaro-search-results"
              aria-activedescendant={searchResults[selectedSearchIndex]
                ? `klaro-search-result-${searchResults[selectedSearchIndex].key}`
                : undefined}
              aria-label="Search panels and canvas elements"
              aria-autocomplete="list"
              placeholder="Search canvas…"
              type="search"
              oninput={handleSearchInput}
              onkeydown={handleSearchKeydown}
            />
            {#if searchQuery}
              <button
                class="editor-search__clear"
                type="button"
                aria-label="Clear canvas search"
                title="Clear search"
                onclick={() => { searchQuery = ''; selectedSearchIndex = 0; searchInputElement?.focus(); }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            {/if}
          </div>
          <button
            class="editor-search__close"
            type="button"
            aria-label="Close canvas search"
            title="Close search"
            onclick={() => closeSearch()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
          <div
            id="klaro-search-results"
            class="editor-search-results"
            role="listbox"
            aria-label="Canvas search results"
          >
            {#if searchQuery.trim() && searchResults.length > 0}
              {#each searchResults as result, index (result.key)}
                <button
                  id={`klaro-search-result-${result.key}`}
                  class="editor-search-result"
                  class:editor-search-result--active={index === selectedSearchIndex}
                  type="button"
                  role="option"
                  aria-selected={index === selectedSearchIndex}
                  onclick={() => focusSearchResult(result)}
                  onmouseenter={() => { selectedSearchIndex = index; }}
                >
                  <span class="editor-search-result__icon" aria-hidden="true">
                    {#if result.kind === 'panel'}
                      <svg viewBox="0 0 20 20"><path d="M3 5.5h5l1.5 2H17v7H3z" /></svg>
                    {:else if result.element.type === 'rectangle'}
                      <svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="11" rx="2" /></svg>
                    {:else if result.element.type === 'text'}
                      <span>T</span>
                    {:else if result.element.type === 'media'}
                      <svg viewBox="0 0 20 20"><path d="M4 4h12v12H4zM6.5 11l2.5-2.5 2 2 1.5-1.5 2.5 3" /></svg>
                    {:else}
                      <svg viewBox="0 0 20 20"><path d="M3 10h11m-4-4 4 4-4 4" /></svg>
                    {/if}
                  </span>
                  <span class="editor-search-result__copy">
                    <strong>{result.label}</strong>
                    <small>{result.subtitle}</small>
                  </span>
                </button>
              {/each}
            {:else if searchQuery.trim()}
              <p class="editor-search-empty">No matching canvas items.</p>
            {:else}
              <p class="editor-search-empty">Type to search this canvas.</p>
            {/if}
          </div>
        </div>
      {:else}
        <button
          bind:this={searchButtonElement}
          class="editor-search-toggle"
          type="button"
          aria-label="Search panels and canvas elements"
          aria-expanded={searchOpen}
          title="Search canvas"
          disabled={!activeFile}
          onclick={toggleSearch}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="4.5" />
            <path d="m12 12 4 4" />
          </svg>
          <span>Search</span>
        </button>
      {/if}
      <span class="draft-indicator">
        <span class="draft-dot" aria-hidden="true"></span>
        Ready
      </span>
    </div>
  </header>

  {#if workspaceSnapshot.active && workspaceSnapshot.openPhase === 'idle'}
    <KnowledgeCanvas
      canvas={canvas}
      {onRenamePanel}
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

  .editor-heading__tools {
    justify-self: end;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    min-width: 0;
  }

  .editor-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .editor-search__field {
    display: flex;
    align-items: center;
    width: clamp(170px, 22vw, 260px);
    height: 30px;
    color: #64776d;
    background: var(--canvas);
    border-radius: 10px;
    box-shadow:
      inset 2px 2px 5px rgb(184 192 204 / 56%),
      inset -2px -2px 5px rgb(255 255 255 / 70%);
    animation: editor-search-open 160ms ease-out both;
  }

  .editor-search__field > svg {
    width: 15px;
    height: 15px;
    flex: none;
    margin-left: 10px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.6;
  }

  .editor-search__field input {
    min-width: 0;
    flex: 1;
    height: 100%;
    padding: 0 5px 0 8px;
    color: #2d3b34;
    background: transparent;
    border: 0;
    outline: 0;
    font: inherit;
    font-size: calc(10px * var(--text-scale));
    font-weight: 560;
  }

  .editor-search__field input::placeholder {
    color: #89968f;
    opacity: 1;
  }

  .editor-search__field input::-webkit-search-cancel-button {
    display: none;
  }

  .editor-search__clear,
  .editor-search__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex: none;
    margin-right: 3px;
    padding: 0;
    color: #76867e;
    background: transparent;
    border: 0;
    border-radius: 7px;
    cursor: pointer;
  }

  .editor-search__clear:hover,
  .editor-search__close:hover {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .editor-search__close {
    color: #63776d;
    background: var(--canvas);
    box-shadow: 2px 2px 5px rgb(184 192 204 / 54%), -2px -2px 5px rgb(255 255 255 / 70%);
  }

  .editor-search__clear:focus-visible,
  .editor-search__close:focus-visible,
  .editor-search-toggle:focus-visible,
  .editor-search-result:focus-visible {
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  .editor-search__clear svg,
  .editor-search__close svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.7;
  }

  .editor-search-results {
    position: absolute;
    z-index: 30;
    top: calc(100% + 8px);
    right: 0;
    display: grid;
    gap: 4px;
    width: min(340px, calc(100vw - 28px));
    max-height: min(420px, calc(100vh - 110px));
    overflow: auto;
    padding: 7px;
    background: var(--canvas);
    border: 1px solid var(--line);
    border-radius: 13px;
    box-shadow: 6px 8px 20px rgb(39 51 67 / 22%);
    animation: editor-search-results-enter 150ms ease-out both;
  }

  .editor-search-result {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 42px;
    padding: 5px 8px 5px 5px;
    color: #33453c;
    background: transparent;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    transition: color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
  }

  .editor-search-result:hover,
  .editor-search-result--active {
    color: #275f50;
    background: color-mix(in srgb, var(--canvas) 78%, var(--accent) 22%);
    box-shadow: inset 1px 1px 3px rgb(39 51 67 / 10%);
  }

  .editor-search-result__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    color: #397565;
    background: color-mix(in srgb, var(--canvas) 80%, var(--accent) 20%);
    border-radius: 8px;
    box-shadow: inset 1px 1px 3px rgb(39 51 67 / 13%), 1px 1px 2px rgb(255 255 255 / 55%);
  }

  .editor-search-result__icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .editor-search-result__icon span {
    color: #775c8d;
    font-family: Georgia, serif;
    font-size: 17px;
    font-weight: 700;
  }

  .editor-search-result__copy {
    min-width: 0;
  }

  .editor-search-result__copy strong,
  .editor-search-result__copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-search-result__copy strong {
    color: inherit;
    font-size: calc(11px * var(--text-scale));
    font-weight: 650;
    line-height: 1.25;
  }

  .editor-search-result__copy small {
    margin-top: 3px;
    color: #75857c;
    font-size: calc(9px * var(--text-scale));
    line-height: 1.2;
  }

  .editor-search-empty {
    margin: 4px 6px;
    padding: 8px 4px;
    color: #75857c;
    font-size: calc(10px * var(--text-scale));
    text-align: center;
  }

  .editor-search-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
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

  .editor-create-panel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
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

  .editor-create-panel:hover {
    color: var(--accent);
    transform: translateY(-1px);
  }

  .editor-create-panel:active {
    box-shadow: inset 2px 2px 5px rgb(184 192 204 / 62%);
    transform: translateY(0);
  }

  .editor-create-panel:focus-visible {
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  .editor-create-panel svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.7;
  }

  .editor-search-toggle:hover:not(:disabled) {
    color: var(--accent);
    transform: translateY(-1px);
  }

  .editor-search-toggle:active:not(:disabled) {
    box-shadow: inset 2px 2px 5px rgb(184 192 204 / 62%);
    transform: translateY(0);
  }

  .editor-search-toggle:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .editor-search-toggle svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.7;
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

  @keyframes editor-search-open {
    from {
      opacity: 0;
      transform: scaleX(0.94);
      transform-origin: right center;
    }

    to {
      opacity: 1;
      transform: scaleX(1);
    }
  }

  @keyframes editor-search-results-enter {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 760px) {
    .editor-panel {
      grid-template-rows: 90px minmax(0, 1fr);
    }

    .editor-heading {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: 48px 42px;
      row-gap: 0;
    }

    .editor-heading__title {
      grid-column: 1 / -1;
      grid-row: 2;
      justify-self: start;
    }

    .editor-heading__navigation {
      grid-column: 1;
      grid-row: 1;
    }

    .editor-heading__tools {
      grid-column: 2;
      grid-row: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .editor-search__field,
    .editor-search-results,
    .editor-create-panel,
    .editor-search-toggle,
    .editor-search-result {
      animation: none;
      transition: none;
    }
  }
</style>
