<script lang="ts">
  import type { NodoStorageItem } from '../../lib/domain/nodo';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    error: string | null;
    items: readonly NodoStorageItem[];
    loading: boolean;
    onBack: () => void;
    onDelete: (item: NodoStorageItem) => void | Promise<void>;
    onRefresh: () => void | Promise<void>;
    subtitle: string;
    title: string;
  };

  let {
    error,
    items,
    loading,
    onBack,
    onDelete,
    onRefresh,
    subtitle,
    title,
  }: Props = $props();
  let confirmingId = $state<string | null>(null);

  function bytes(value: number): string {
    if (value < 1_024) return `${value} B`;
    if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
    if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
    return `${(value / 1_073_741_824).toFixed(2)} GB`;
  }

  function date(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  }

  function kindLabel(item: NodoStorageItem): string {
    switch (item.kind) {
      case 'file': return item.mimeType?.startsWith('video/') ? 'Video file' : item.mimeType?.startsWith('image/') ? 'Image file' : 'File';
      case 'fluo-post': return 'Fluo post';
      case 'ligo-envelope': return 'Ligo message';
      case 'rondo-message': return 'Rondo message';
    }
  }

  function icon(item: NodoStorageItem): string {
    switch (item.kind) {
      case 'file': return item.mimeType?.startsWith('video/') ? '▶' : item.mimeType?.startsWith('image/') ? '▧' : '⌁';
      case 'fluo-post': return '✦';
      case 'ligo-envelope': return '↗';
      case 'rondo-message': return '◌';
    }
  }
</script>

<section class="storage-browser" aria-labelledby="storage-browser-title">
  <div class="storage-browser-inner">
    <header class="browser-header">
      <div class="browser-title-wrap">
        <button class="back-button" type="button" onclick={onBack} aria-label="Back to Nodo">
          <span aria-hidden="true">‹</span>
          Back
        </button>
        <div>
          <span class="eyebrow">Storage browser</span>
          <h1 id="storage-browser-title">{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <button class="refresh-button" type="button" disabled={loading} onclick={onRefresh}>
        {#if loading}<LoadingSpinner compact />{:else}<span aria-hidden="true">↻</span>{/if}
        Refresh
      </button>
    </header>

  {#if error}
    <div class="browser-error" role="alert">{error}</div>
  {/if}

  {#if loading && items.length === 0}
    <div class="browser-state"><LoadingSpinner /><strong>Reading Nodo contents…</strong><span>Only compact metadata is loaded here. Media stays on the host.</span></div>
  {:else if items.length === 0}
    <div class="browser-state empty"><span class="empty-icon" aria-hidden="true">⌂</span><strong>No stored data yet</strong><span>This space is currently empty.</span></div>
  {:else}
    <div class="items-summary"><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span><small>Sorted newest first · content remains on the Nodo</small></div>
    <div class="items-list">
      {#each items as item (item.nodeId + item.space + item.kind + item.storageKey)}
        <article class="storage-item" class:incomplete={!item.completed}>
          <span class="item-icon" aria-hidden="true">{icon(item)}</span>
          <div class="item-copy">
            <div class="item-name-row">
              <strong title={item.name}>{item.name}</strong>
              {#if !item.completed}<span class="partial-badge">Partial</span>{/if}
            </div>
            <div class="item-meta">
              <span>{kindLabel(item)}</span>
              <span>{bytes(item.sizeBytes)}</span>
              <span>{date(item.createdAt)}</span>
              {#if item.owner}<span>by {item.owner}</span>{/if}
              {#if item.nodeName}<span class="node-tag">{item.nodeName}</span>{/if}
            </div>
            {#if item.preview}<p>{item.preview}</p>{/if}
          </div>
          {#if item.deletable}
            <button
              class:confirm={confirmingId === item.storageKey}
              class="delete-button"
              type="button"
              onclick={() => {
                if (confirmingId !== item.storageKey) {
                  confirmingId = item.storageKey;
                  return;
                }
                confirmingId = null;
                void onDelete(item);
              }}
            >
              {confirmingId === item.storageKey ? 'Confirm' : 'Delete'}
            </button>
          {:else}
            <span class="read-only">Read-only</span>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
  </div>
</section>

<style>
  .storage-browser {
    position: fixed;
    z-index: 20;
    inset: 56px 0 28px;
    overflow: auto;
    color: #2a3931;
    background: radial-gradient(circle at 76% 0%, rgb(72 144 118 / 12%), transparent 34%), #f3f6f2;
    animation: browser-enter 180ms ease-out both;
  }

  .storage-browser-inner { width: min(100%, 1020px); min-height: 100%; margin: 0 auto; padding: 30px 34px 58px; }
  .browser-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
  .browser-title-wrap { display: flex; align-items: flex-start; gap: 18px; }
  .back-button, .refresh-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 31px; flex: none; padding: 0 11px; color: #446d5c; background: rgb(255 255 255 / 84%); border: 1px solid #d2e0d7; border-radius: 8px; cursor: pointer; font: inherit; font-size: calc(9px * var(--text-scale)); font-weight: 680; }
  .back-button:hover, .refresh-button:hover:not(:disabled) { background: #fff; border-color: #accab9; }
  .back-button span { font-size: 18px; line-height: 0; }
  .refresh-button { min-width: 86px; }
  .refresh-button:disabled { cursor: wait; opacity: .65; }
  .eyebrow { color: #4e836f; font-size: calc(9px * var(--text-scale)); font-weight: 760; letter-spacing: .15em; text-transform: uppercase; }
  h1 { margin-top: 6px; color: #22332a; font-size: calc(27px * var(--text-scale)); letter-spacing: -.045em; }
  .browser-header p { margin-top: 7px; color: #7b8880; font-size: calc(10px * var(--text-scale)); }
  .browser-error { margin-bottom: 13px; padding: 10px 12px; color: #8e4944; background: #fbefed; border: 1px solid #ebd0cd; border-radius: 9px; font-size: calc(9px * var(--text-scale)); }
  .items-summary { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 9px; padding: 0 3px; color: #50655a; font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .items-summary small { color: #929e97; font-size: calc(8px * var(--text-scale)); font-weight: 500; }
  .items-list { overflow: hidden; background: rgb(255 255 255 / 83%); border: 1px solid #dbe4de; border-radius: 14px; box-shadow: 0 12px 30px rgb(43 75 60 / 5%); }
  .storage-item { display: flex; align-items: center; gap: 13px; min-width: 0; padding: 14px 16px; border-top: 1px solid #e8ede9; }
  .storage-item:first-child { border-top: 0; }
  .storage-item.incomplete { background: #fffaf3; }
  .item-icon { display: grid; width: 38px; height: 38px; flex: none; color: #3e806a; background: #e8f2ed; border: 1px solid #cce0d5; border-radius: 10px; font-size: 17px; place-items: center; }
  .incomplete .item-icon { color: #a57543; background: #fff1df; border-color: #eed7b9; }
  .item-copy { min-width: 0; flex: 1; }
  .item-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .item-name-row strong { overflow: hidden; color: #30443a; font-size: calc(10px * var(--text-scale)); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .partial-badge { padding: 3px 6px; color: #9b6b3e; background: #fff0df; border: 1px solid #eed7b9; border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-weight: 700; text-transform: uppercase; }
  .item-meta { display: flex; flex-wrap: wrap; gap: 5px 11px; margin-top: 5px; color: #89968e; font-size: calc(8px * var(--text-scale)); }
  .item-meta span + span::before { margin-right: 10px; color: #c1cac4; content: '·'; }
  .item-meta .node-tag { color: #5c8471; font-weight: 650; }
  .item-copy p { max-width: 680px; margin-top: 6px; overflow: hidden; color: #77857d; font-size: calc(8px * var(--text-scale)); line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
  .delete-button { min-width: 58px; height: 28px; padding: 0 8px; color: #9a5349; background: #fff; border: 1px solid #e6cbc6; border-radius: 7px; cursor: pointer; font: inherit; font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .delete-button:hover { background: #fff6f4; border-color: #d9aaa3; }
  .delete-button.confirm { color: #fff; background: #a35c51; border-color: #a35c51; }
  .read-only { flex: none; color: #a1aaa4; font-size: calc(8px * var(--text-scale)); }
  .browser-state { display: grid; min-height: 300px; padding: 40px; background: rgb(255 255 255 / 82%); border: 1px solid #dce4de; border-radius: 14px; place-items: center; align-content: center; gap: 9px; color: #6e7f75; text-align: center; }
  .browser-state strong { color: #3d5749; font-size: calc(12px * var(--text-scale)); }
  .browser-state span:not(.empty-icon) { color: #93a098; font-size: calc(9px * var(--text-scale)); }
  .empty-icon { display: grid; width: 45px; height: 45px; color: #6a9c87; background: #e7f1eb; border-radius: 13px; font-size: 21px; place-items: center; }
  @keyframes browser-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
  @media (max-width: 700px) {
    .storage-browser-inner { padding: 22px 15px 40px; }
    .browser-header { align-items: flex-start; flex-direction: column; }
    .storage-item { align-items: flex-start; flex-wrap: wrap; }
    .delete-button, .read-only { margin-left: 51px; }
  }
  @media (prefers-reduced-motion: reduce) { .storage-browser { animation: none; } }
</style>
