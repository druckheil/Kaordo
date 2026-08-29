<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodoNode, PublicNodoStorage } from '../../lib/domain/nodo';
  import { PUBLIC_LIGO_DESTINATION } from '../../lib/gateways/NodeLigoTransport';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    busy: boolean;
    nodes: readonly NodoNode[];
    onClose: () => void;
    onSave: (selectedNodeId: string, stackLimitBytes: number) => Promise<boolean>;
    publicStorage: PublicNodoStorage | null;
    selectedNodeId: string;
    stackLimitBytes: number;
    stackUsedBytes: number;
  };

  let {
    busy,
    nodes,
    onClose,
    onSave,
    publicStorage,
    selectedNodeId,
    stackLimitBytes,
    stackUsedBytes,
  }: Props = $props();
  let dialog = $state<HTMLElement>();
  let draftNodeId = $state('');
  let draftLimitMb = $state(1);
  let privateNodes = $derived(nodes.filter(({ spaces }) => spaces.private.quotaBytes > 0));
  let selectedPrivate = $derived(privateNodes.find(({ id }) => id === draftNodeId));
  let selectedQuotaBytes = $derived(draftNodeId === PUBLIC_LIGO_DESTINATION
    ? publicStorage?.limitBytes ?? 1_073_741_824
    : selectedPrivate?.spaces.private.quotaBytes ?? 1_048_576);
  let selectedUsedBytes = $derived(draftNodeId === PUBLIC_LIGO_DESTINATION
    ? (publicStorage?.usedBytes ?? 0) + (publicStorage?.reservedBytes ?? 0)
    : selectedPrivate?.spaces.private.usedBytes ?? 0);
  let maximumMb = $derived(Math.max(1, Math.floor(selectedQuotaBytes / 1_048_576)));
  let storageFill = $derived(percent(selectedUsedBytes, selectedQuotaBytes));
  let stackBytes = $derived(draftLimitMb * 1_048_576);
  let stackFill = $derived(percent(stackUsedBytes, stackBytes));

  $effect(() => { draftLimitMb = Math.min(draftLimitMb, maximumMb); });
  onMount(() => {
    draftNodeId = selectedNodeId;
    draftLimitMb = Math.max(1, Math.round(stackLimitBytes / 1_048_576));
    dialog?.focus();
  });

  async function save() {
    if (busy || !destinationAvailable(draftNodeId)) return;
    if (await onSave(draftNodeId, stackBytes)) onClose();
  }

  function destinationAvailable(id: string): boolean {
    if (id === PUBLIC_LIGO_DESTINATION) return Boolean(publicStorage?.nodeCandidates.length);
    const node = privateNodes.find((item) => item.id === id);
    return Boolean(node?.online && node.policy.allowUploads);
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || busy) return;
    event.preventDefault();
    onClose();
  }
  function percent(used: number, total: number): number {
    return Math.min(100, Math.max(0, used / Math.max(1, total) * 100));
  }
  function meterColor(value: number): string {
    return `hsl(${Math.round(122 - Math.min(100, value) * 1.22)} 58% 42%)`;
  }
  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }
</script>

<div class="storage-modal">
  <button class="backdrop" type="button" aria-label="Close storage settings" onclick={onClose}></button>
  <div bind:this={dialog} class="storage-dialog" role="dialog" aria-modal="true"
    aria-labelledby="ligo-storage-title" tabindex="-1" onkeydown={keydown}>
    <header>
      <span class="cassette" aria-hidden="true">
        <svg viewBox="0 0 28 28"><rect x="4" y="4.5" width="20" height="19" rx="3"/><circle cx="10" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M8 21l2-5h8l2 5M10 12h8"/></svg>
      </span>
      <div><small>LIGO STORAGE</small><h2 id="ligo-storage-title">Message cloud</h2></div>
      <button class="close" type="button" aria-label="Close" disabled={busy} onclick={onClose}>×</button>
    </header>

    <div class="content">
      <div class="intro"><strong>Choose where messages wait</strong><p>Your contact can read this conversation window, while only you control its size and location.</p></div>
      <div class="destinations">
        <button type="button" class:selected={draftNodeId === PUBLIC_LIGO_DESTINATION}
          disabled={!destinationAvailable(PUBLIC_LIGO_DESTINATION)}
          onclick={() => { draftNodeId = PUBLIC_LIGO_DESTINATION; }}>
          <span class="node-icon public">◎</span>
          <span class="node-copy"><strong>Public Nodo</strong><small>Shared 1 GB reserve</small></span>
          <i>{draftNodeId === PUBLIC_LIGO_DESTINATION ? '✓' : ''}</i>
        </button>
        {#each privateNodes as node (node.id)}
          <button type="button" class:selected={draftNodeId === node.id}
            disabled={!destinationAvailable(node.id)} onclick={() => { draftNodeId = node.id; }}>
            <span class="node-icon">▣</span>
            <span class="node-copy"><strong>{node.deviceName}</strong><small>{node.online ? 'Private Nodo' : 'Offline'}</small></span>
            <i>{draftNodeId === node.id ? '✓' : ''}</i>
          </button>
        {/each}
      </div>

      <section class="meter-card">
        <div class="meter-heading"><span><small>SELECTED NODO</small><strong>{formatBytes(selectedUsedBytes)} of {formatBytes(selectedQuotaBytes)}</strong></span><b style={`color:${meterColor(storageFill)}`}>{Math.round(storageFill)}%</b></div>
        <div class="meter"><i style={`width:${storageFill}%;background:${meterColor(storageFill)}`}></i></div>
      </section>

      <section class="stack-card">
        <div class="stack-heading"><span><small>TRANSIT WINDOW</small><strong>{formatBytes(stackBytes)}</strong></span><span class="stack-used"><b>{formatBytes(stackUsedBytes)}</b><small>currently stored</small></span></div>
        <input type="range" min="1" max={maximumMb} step="1" value={draftLimitMb}
          aria-label="Transit message storage in megabytes"
          oninput={(event) => { draftLimitMb = Number((event.currentTarget as HTMLInputElement).value); }} />
        <div class="scale slider-scale"><span>1 MB</span><span>Available up to {formatBytes(selectedQuotaBytes)}</span></div>
        <div class="meter stack"><i style={`width:${stackFill}%;background:${meterColor(stackFill)}`}></i></div>
        <div class="scale"><span>0 B stored</span><span>{formatBytes(stackBytes)} transit limit</span></div>
        <p>New messages enter at the top. Once the window is full, the oldest cloud copies are removed first.</p>
        {#if stackUsedBytes > stackBytes}<p class="warning">Saving will remove approximately {formatBytes(stackUsedBytes - stackBytes)} of the oldest cloud messages.</p>{/if}
      </section>
    </div>

    <footer>
      <span><i style={`background:${meterColor(stackFill)}`}></i>{Math.round(stackFill)}% of the message window filled</span>
      <div><button class="cancel" type="button" disabled={busy} onclick={onClose}>Cancel</button><button class="save" type="button" disabled={busy || !destinationAvailable(draftNodeId)} onclick={save}>{#if busy}<LoadingSpinner compact />{/if}{busy ? 'Saving…' : 'Save'}</button></div>
    </footer>
  </div>
</div>

<style>
  .storage-modal {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow: rgb(39 51 67 / 20%);
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-text: #2d3748;
    --sui-muted: #5a6a7e;
    --sui-light: #6a7d94;
    position: fixed;
    z-index: 120;
    display: grid;
    inset: 0;
    padding: 32px;
    color: var(--sui-text);
    place-items: center;
  }

  :global(html[data-theme='dark']) .storage-modal {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow: rgb(0 0 0 / 42%);
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-text: #e2e8f0;
    --sui-muted: #9ba5b8;
    --sui-light: #8a94a6;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    background: rgb(45 55 72 / 48%);
    border: 0;
    backdrop-filter: blur(7px);
    animation: fade 150ms ease-out both;
  }

  .storage-dialog {
    position: relative;
    width: min(610px, calc(100vw - 56px));
    max-height: calc(100vh - 64px);
    overflow: auto;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: 22px;
    box-shadow: 0 16px 36px var(--sui-shadow);
    outline: 0;
    animation: enter 180ms cubic-bezier(.2, .8, .2, 1) both;
  }

  .storage-dialog > header {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 18px 20px;
    background: var(--sui-bg);
    border-bottom: 0;
    box-shadow: var(--sui-shadow-raised-sm, 0 3px 8px var(--sui-shadow));
  }

  .cassette {
    display: grid;
    width: 44px;
    height: 44px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 13px;
    box-shadow: inset 2px 2px 5px var(--sui-shadow), inset -2px -2px 5px rgb(255 255 255 / 0%);
    place-items: center;
  }

  .cassette svg { width: 26px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .storage-dialog header div { display: grid; gap: 3px; }
  .storage-dialog header small, .intro p, .stack-card p { color: var(--sui-muted); }
  .storage-dialog header small, .meter-heading small, .stack-heading small { font-size: calc(9px * var(--text-scale)); font-weight: 750; letter-spacing: .12em; }
  .storage-dialog h2 { margin: 0; color: var(--sui-text); font-size: calc(19px * var(--text-scale)); letter-spacing: -.03em; }

  .close {
    display: grid;
    width: 34px;
    height: 34px;
    margin-left: auto;
    padding: 0;
    color: var(--sui-muted);
    background: var(--sui-bg);
    border: 0;
    border-radius: 10px;
    box-shadow: 0 3px 8px var(--sui-shadow);
    cursor: pointer;
    font-size: 22px;
    place-items: center;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .close:hover:not(:disabled) { color: var(--sui-text); transform: translateY(-1px); }
  .close:active:not(:disabled) { box-shadow: inset 2px 2px 5px var(--sui-shadow); transform: none; }
  .close:disabled { cursor: default; opacity: .5; }
  .content { display: grid; gap: 16px; padding: 20px; }
  .intro { display: grid; gap: 4px; }
  .intro strong { color: var(--sui-text); font-size: calc(13px * var(--text-scale)); }
  .intro p { margin: 0; font-size: calc(11px * var(--text-scale)); line-height: 1.5; }

  .destinations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .destinations button {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 12px;
    color: var(--sui-text);
    text-align: left;
    background: var(--sui-bg);
    border: 0;
    border-radius: 13px;
    box-shadow: 0 3px 8px var(--sui-shadow);
    cursor: pointer;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .destinations button:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); }
  .destinations button:active:not(:disabled), .destinations button.selected { box-shadow: inset 3px 3px 8px var(--sui-shadow); transform: none; }
  .destinations button.selected { color: var(--sui-primary); }
  .destinations button:disabled { cursor: default; opacity: .46; }
  .node-icon { display: grid; flex: none; width: 34px; height: 34px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 10px; box-shadow: inset 2px 2px 5px var(--sui-shadow); place-items: center; }
  .node-icon.public { font-size: 21px; }
  .node-copy { display: grid; min-width: 0; gap: 3px; }
  .node-copy strong, .node-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-copy strong { font-size: calc(11px * var(--text-scale)); }
  .node-copy small { color: var(--sui-muted); font-size: calc(9px * var(--text-scale)); }
  .destinations button > i { margin-left: auto; color: var(--sui-primary); font-style: normal; font-weight: 800; }

  .meter-card, .stack-card { padding: 15px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 15px; box-shadow: var(--sui-shadow-raised-sm, 0 3px 8px var(--sui-shadow)); }
  .meter-heading, .stack-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .meter-heading span, .stack-heading > span:first-child { display: grid; gap: 4px; }
  .meter-heading strong, .stack-heading strong { font-size: calc(12px * var(--text-scale)); }
  .meter-heading b { font-size: calc(18px * var(--text-scale)); }
  .meter { height: 7px; margin-top: 12px; overflow: hidden; background: color-mix(in srgb, var(--sui-muted) 13%, transparent); border-radius: 999px; box-shadow: inset 2px 2px 5px var(--sui-shadow); }
  .meter i { display: block; height: 100%; border-radius: inherit; transition: width 180ms ease, background 180ms ease; }
  .stack-heading { margin-bottom: 13px; }
  .stack-used { display: grid; text-align: right; }
  .stack-used b { font-size: calc(11px * var(--text-scale)); }
  .stack-used small { color: var(--sui-muted); font-size: calc(8px * var(--text-scale)); }
  .stack-card input { width: 100%; accent-color: var(--sui-primary); cursor: pointer; }
  .meter.stack { height: 5px; margin-top: 9px; }
  .scale { display: flex; justify-content: space-between; margin-top: 5px; color: var(--sui-muted); font-size: calc(8px * var(--text-scale)); }
  .stack-card p { margin: 10px 0 0; font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  .stack-card p.warning { color: #b56c50; }

  .storage-dialog > footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 20px; color: var(--sui-text); background: var(--sui-bg); border-top: 0; box-shadow: 0 -3px 10px color-mix(in srgb, var(--sui-shadow) 38%, transparent); }
  .storage-dialog > footer > span { display: flex; align-items: center; gap: 7px; color: var(--sui-muted); font-size: calc(9px * var(--text-scale)); }
  .storage-dialog > footer > span i { width: 8px; height: 8px; border-radius: 50%; }
  .storage-dialog > footer > div { display: flex; gap: 8px; }
  .storage-dialog footer button { height: 36px; padding: 0 15px; border: 0; border-radius: 10px; font: inherit; font-size: calc(11px * var(--text-scale)); font-weight: 650; cursor: pointer; transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .cancel { color: var(--sui-text-muted, var(--sui-muted)); background: var(--sui-bg); box-shadow: 0 3px 8px var(--sui-shadow); }
  .cancel:hover:not(:disabled) { color: var(--sui-text); transform: translateY(-1px); }
  .cancel:active:not(:disabled) { box-shadow: inset 2px 2px 5px var(--sui-shadow); transform: none; }
  .save { display: flex; align-items: center; gap: 7px; color: #fff; background: var(--sui-primary); box-shadow: 0 3px 8px var(--sui-shadow); }
  .save:hover:not(:disabled) { background: var(--sui-primary-hover); transform: translateY(-1px); }
  .save:active:not(:disabled) { box-shadow: inset 2px 2px 5px color-mix(in srgb, var(--sui-shadow) 80%, #111); transform: none; }
  .storage-dialog footer button:disabled { cursor: default; opacity: .5; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes enter { from { opacity: 0; transform: translateY(8px) scale(.985); } }
  @media (max-width: 620px) { .destinations { grid-template-columns: 1fr; } .storage-dialog > footer { align-items: stretch; flex-direction: column; } .storage-dialog > footer > div { justify-content: flex-end; } }
  @media (prefers-reduced-motion: reduce) { .backdrop, .storage-dialog, .close, .destinations button, .storage-dialog footer button, .meter i { animation: none; transition: none; } }
</style>
