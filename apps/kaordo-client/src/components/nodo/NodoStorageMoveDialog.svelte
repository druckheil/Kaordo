<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodoNode, NodoStorageMoveProgress } from '../../lib/domain/nodo';
  import type { NodoOperation } from '../../lib/states/NodoGState';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    error: string | null;
    nodes: readonly NodoNode[];
    onClose: () => void;
    onMove: (sourceNodeId: string, targetNodeId: string) => void | Promise<boolean>;
    operation: NodoOperation | null;
    source: NodoNode;
  };

  let { error, nodes, onClose, onMove, operation, source }: Props = $props();
  let dialog = $state<HTMLElement>();
  let targetId = $state<string | null>(null);
  let target = $derived(nodes.find((node) => node.id === targetId && node.id !== source.id));
  let moving = $derived(operation?.nodeId === source.id && operation.type === 'move');
  let availableTargets = $derived(nodes.filter((node) => node.id !== source.id && destinationAvailable(node)));

  onMount(() => {
    dialog?.focus();
  });

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      keepFocusInsideDialog(event);
      return;
    }
    if (event.key !== 'Escape' || moving) return;
    event.preventDefault();
    onClose();
  }

  function keepFocusInsideDialog(event: KeyboardEvent) {
    const focusable = Array.from(
      dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      ) ?? [],
    );
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseTarget(node: NodoNode) {
    if (moving || !destinationAvailable(node)) return;
    targetId = node.id;
  }

  async function confirmMove() {
    if (moving || !target || !destinationAvailable(target)) return;
    if (await onMove(source.id, target.id)) onClose();
  }

  function destinationAvailable(node: NodoNode): boolean {
    return source.online && node.online && supportsStorageMove(source) && supportsStorageMove(node) &&
      source.policy.allowDownloads && node.policy.allowUploads &&
      source.spaces.private.usedBytes <= freeBytes(node, 'private') &&
      source.spaces.public.usedBytes <= freeBytes(node, 'public');
  }

  function destinationStatus(node: NodoNode): string {
    if (!source.online) return 'Source offline';
    if (!node.online) return 'Offline';
    if (!supportsStorageMove(source) || !supportsStorageMove(node)) return 'Update Nodo to 0.2.6+';
    if (!source.policy.allowDownloads) return 'Downloads disabled on source';
    if (!node.policy.allowUploads) return 'Uploads disabled';
    if (source.spaces.private.usedBytes > freeBytes(node, 'private') ||
        source.spaces.public.usedBytes > freeBytes(node, 'public')) return 'Not enough space';
    return 'Available';
  }

  function freeBytes(node: NodoNode, space: 'private' | 'public'): number {
    const selectedSpace = node.spaces[space];
    return Math.max(0, selectedSpace.quotaBytes - selectedSpace.usedBytes);
  }

  function supportsStorageMove(node: NodoNode): boolean {
    const version = node.metrics.appVersion;
    if (!version) return false;
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+.]|$)/u);
    if (!match) return false;
    const current = [Number(match[1]), Number(match[2]), Number(match[3])];
    return current[0] > 0 || current[1] > 2 ||
      (current[1] === 2 && current[2] >= 6);
  }

  function bytes(value: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = Math.max(0, value);
    let unit = 0;
    while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
    const precision = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(precision)} ${units[unit]}`;
  }

  function progressPercent(progress: NodoStorageMoveProgress | undefined): number {
    if (!progress) return 0;
    if (progress.totalBytes <= 0) return progress.phase === 'copying' ? 0 : 100;
    return Math.min(100, Math.max(0, Math.round(progress.completedBytes / progress.totalBytes * 100)));
  }

  function progressLabel(progress: NodoStorageMoveProgress | undefined): string {
    if (!progress) return 'Preparing transfer…';
    if (progress.phase === 'committing') return 'Updating storage routes…';
    if (progress.phase === 'removing') return 'Removing source copies…';
    if (progress.currentItem >= progress.totalItems) return 'Content copied';
    return progress.totalItems > 0
      ? `Copying item ${progress.currentItem + 1} of ${progress.totalItems}…`
      : 'Preparing content transfer…';
  }

  function progressDetail(progress: NodoStorageMoveProgress | undefined): string {
    if (!progress || progress.totalBytes <= 0) return 'Preparing content transfer…';
    return `${bytes(progress.completedBytes)} of ${bytes(progress.totalBytes)} copied`;
  }
</script>

<div class="storage-modal" role="presentation">
  <button class="backdrop" type="button" aria-label="Close Nodo storage move dialog" disabled={moving} onclick={onClose}></button>
  <div
    bind:this={dialog}
    class="storage-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="nodo-storage-move-title"
    aria-describedby="nodo-storage-move-description"
    tabindex="-1"
    onkeydown={keydown}
  >
    <header>
      <span class="cassette" aria-hidden="true">
        <svg viewBox="0 0 28 28"><path d="M4 9h15"/><path d="m15 5 4 4-4 4"/><path d="M24 19H9"/><path d="m13 15-4 4 4 4"/></svg>
      </span>
      <div>
        <small>NODO STORAGE</small>
        <h2 id="nodo-storage-move-title">{moving ? 'Moving content' : target ? 'Confirm content move' : 'Move all content'}</h2>
      </div>
      <button class="close" type="button" aria-label="Close" disabled={moving} onclick={onClose}>×</button>
    </header>

    {#if moving}
      {@const progress = operation?.type === 'move' ? operation.progress : undefined}
      {@const percent = progressPercent(progress)}
      <div class="content">
        <div class="intro">
          <strong>Moving content between Nodos</strong>
          <p id="nodo-storage-move-description">Keep “{source.deviceName}” and the destination Nodo online until the transfer finishes.</p>
        </div>
        <div class="move-route" aria-label={`Moving content from ${source.deviceName} to ${target?.deviceName ?? 'the destination Nodo'}`}>
          <div class="route-node"><small>SOURCE</small><strong>{source.deviceName}</strong><span>{bytes(source.spaces.private.usedBytes)} Private · {bytes(source.spaces.public.usedBytes)} Public</span></div>
          <b class="route-arrow" aria-hidden="true">→</b>
          <div class="route-node"><small>DESTINATION</small><strong>{target?.deviceName ?? 'Nodo'}</strong><span>Receiving matching spaces</span></div>
        </div>
        <div class="transfer-progress">
          <div class="progress-heading"><span>{progressLabel(progress)}</span><strong>{percent}%</strong></div>
          <div class="progress-track" role="progressbar" aria-label="Content move progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style={`width: ${percent}%`}></span></div>
          <small>{progressDetail(progress)}</small>
        </div>
        <div class="transfer-state"><LoadingSpinner compact /><span>Keep both Nodos online until the transfer finishes.</span></div>
      </div>
      <footer>
        <span><i class="status-live"></i>{percent}% complete</span>
        <div><button class="cancel" type="button" disabled>Keep window open</button></div>
      </footer>
    {:else if target}
      {@const destination = target}
      <div class="content">
        <div class="intro">
          <strong>Confirm this transfer</strong>
          <p id="nodo-storage-move-description">Everything will be copied to the destination, then removed from the source. Public content stays Public and Private content stays Private.</p>
        </div>
        <div class="move-route" aria-label={`Move content from ${source.deviceName} to ${destination.deviceName}`}>
          <div class="route-node"><small>SOURCE</small><strong>{source.deviceName}</strong><span>{bytes(source.spaces.private.usedBytes)} Private · {bytes(source.spaces.public.usedBytes)} Public</span></div>
          <b class="route-arrow" aria-hidden="true">→</b>
          <div class="route-node"><small>DESTINATION</small><strong>{destination.deviceName}</strong><span>{bytes(freeBytes(destination, 'private'))} Private · {bytes(freeBytes(destination, 'public'))} Public free</span></div>
        </div>
        <div class="space-preservation"><span><b>P</b><strong>Public → Public</strong><small>Public content keeps its shared permissions.</small></span><span><b>L</b><strong>Private → Private</strong><small>Private content remains owner-controlled.</small></span></div>
        {#if error}<p class="dialog-error" role="alert">{error}</p>{/if}
      </div>
      <footer>
        <span><i class="status-ready"></i>Ready to move</span>
        <div><button class="cancel" type="button" onclick={onClose}>Cancel</button><button class="save" type="button" onclick={() => void confirmMove()}>Move content</button></div>
      </footer>
    {:else}
      <div class="content">
        <div class="intro">
          <strong>Choose the destination Nodo</strong>
          <p id="nodo-storage-move-description">Public content stays Public. Private content stays Private. Both Nodos must remain online during the transfer.</p>
        </div>
        <div class="destinations">
          {#each nodes.filter((node) => node.id !== source.id) as node (node.id)}
            {@const available = destinationAvailable(node)}
            <button class:selected={targetId === node.id} class="move-target" type="button" disabled={!available} aria-pressed={targetId === node.id} onclick={() => chooseTarget(node)}>
              <span class:online={node.online} class="node-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20"><rect x="4" y="3.5" width="12" height="10" rx="1.8"/><path d="M7 16.5h6M10 13.5v3"/></svg>
              </span>
              <span class="node-copy"><strong>{node.deviceName}</strong><small>{node.online ? `${bytes(freeBytes(node, 'private'))} Private free · ${bytes(freeBytes(node, 'public'))} Public free` : 'Offline'}</small></span>
              <span class:available class="target-status">{destinationStatus(node)}</span>
            </button>
          {:else}
            <div class="empty-state">No other Nodo is ready to receive this content.</div>
          {/each}
        </div>
        {#if error}<p class="dialog-error" role="alert">{error}</p>{/if}
      </div>
      <footer>
        <span><i class="status-ready"></i>{availableTargets.length} destination{availableTargets.length === 1 ? '' : 's'} available</span>
        <div><button class="cancel" type="button" onclick={onClose}>Cancel</button></div>
      </footer>
    {/if}
  </div>
</div>

<style>
  .storage-modal {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #c95667;
    --sui-text: #2d3748;
    --sui-muted: #5a6a7e;
    --sui-light: #6a7d94;
    --sui-shadow: rgb(39 51 67 / 20%);
    --sui-raised: 0 14px 28px var(--sui-shadow);
    --sui-raised-sm: 0 4px 10px rgb(39 51 67 / 17%), -3px -3px 8px rgb(255 255 255 / 48%);
    --sui-inset: inset 3px 3px 8px var(--sui-shadow), inset -3px -3px 8px rgb(255 255 255 / 42%);
    --sui-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%);
    position: fixed;
    z-index: 120;
    inset: var(--app-header-height, 32px) 0 0;
    display: grid;
    box-sizing: border-box;
    min-height: 0;
    padding: 32px;
    color: var(--sui-text);
    place-items: center;
    overflow: hidden;
  }

  :global(html[data-theme='dark']) .storage-modal {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-text: #e2e8f0;
    --sui-muted: #aab4c5;
    --sui-light: #8a94a6;
    --sui-shadow: rgb(0 0 0 / 42%);
    --sui-raised: 0 13px 28px var(--sui-shadow);
    --sui-raised-sm: 0 5px 12px rgb(0 0 0 / 36%);
    --sui-inset: inset 3px 3px 8px rgb(0 0 0 / 32%), inset -3px -3px 8px rgb(255 255 255 / 4%);
    --sui-inset-sm: inset 2px 2px 6px rgb(0 0 0 / 32%), inset -2px -2px 5px rgb(255 255 255 / 4%);
  }

  .backdrop { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; background: color-mix(in srgb, var(--chrome, #1c2825) 38%, transparent); border: 0; backdrop-filter: blur(5px); cursor: default; animation: move-fade 150ms ease-out both; }
  .backdrop:disabled { cursor: default; }

  .storage-dialog { position: relative; z-index: 1; display: flex; flex-direction: column; width: min(610px, calc(100vw - 56px)); max-height: calc(100% - 32px); min-height: 0; overflow: hidden; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 22px; box-shadow: var(--sui-raised); outline: 0; animation: move-enter 180ms cubic-bezier(.2, .8, .2, 1) both; }
  .storage-dialog > header { display: flex; flex: 0 0 auto; align-items: center; gap: 13px; padding: 18px 20px; background: linear-gradient(145deg, var(--sui-bg-light), var(--sui-bg)); border: 0; box-shadow: var(--sui-raised-sm); }
  .cassette { display: grid; width: 44px; height: 44px; flex: none; color: var(--sui-primary); background: var(--sui-bg); border-radius: 13px; box-shadow: var(--sui-inset-sm); place-items: center; }
  .cassette svg { width: 27px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .storage-dialog header div { display: grid; gap: 3px; min-width: 0; }
  .storage-dialog header small { color: var(--sui-primary); font-size: calc(9px * var(--text-scale)); font-weight: 750; letter-spacing: .12em; }
  .storage-dialog h2 { margin: 0; overflow: hidden; color: var(--sui-text); font-size: calc(19px * var(--text-scale)); letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
  .close { display: grid; width: 34px; height: 34px; margin-left: auto; padding: 0; color: var(--sui-muted); background: var(--sui-bg); border: 0; border-radius: 50%; box-shadow: var(--sui-raised-sm); cursor: pointer; font-size: 22px; place-items: center; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .close:hover:not(:disabled) { color: var(--sui-primary); box-shadow: var(--sui-inset-sm); transform: translateY(-1px); }
  .close:active:not(:disabled) { transform: translateY(1px); }
  .close:disabled { cursor: default; opacity: .5; }

  .content { display: grid; gap: 16px; min-height: 0; padding: 20px; overflow: auto; overscroll-behavior: contain; }
  .intro { display: grid; gap: 4px; }
  .intro strong { color: var(--sui-text); font-size: calc(13px * var(--text-scale)); }
  .intro p { margin: 0; color: var(--sui-muted); font-size: calc(11px * var(--text-scale)); line-height: 1.5; }
  .destinations { display: grid; gap: 9px; }
  .move-target { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; min-height: 66px; padding: 11px; color: var(--sui-text); text-align: left; background: var(--sui-bg); border: 0; border-radius: 16px; box-shadow: var(--sui-raised-sm); outline: none; cursor: pointer; transition: transform 120ms ease, box-shadow 120ms ease, color 120ms ease; }
  .move-target:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); }
  .move-target.selected, .move-target.selected:hover:not(:disabled) { color: var(--sui-primary); box-shadow: var(--sui-inset-sm); transform: translateY(1px); }
  .move-target:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 50%, transparent); outline-offset: 3px; }
  .move-target:disabled { cursor: default; opacity: .46; }
  .node-icon { position: relative; display: grid; width: 36px; height: 36px; flex: none; color: var(--sui-primary); background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-inset-sm); place-items: center; }
  .node-icon svg { width: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .node-icon::after { position: absolute; right: 4px; bottom: 4px; width: 7px; height: 7px; background: var(--sui-light); border: 1px solid var(--sui-bg); border-radius: 50%; content: ''; }
  .node-icon.online::after { background: var(--sui-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sui-success) 15%, transparent); }
  .node-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
  .node-copy strong, .node-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-copy strong { font-size: calc(11px * var(--text-scale)); }
  .node-copy small { color: var(--sui-muted); font-size: calc(9px * var(--text-scale)); }
  .target-status { flex: none; color: var(--sui-light); font-size: calc(9px * var(--text-scale)); font-weight: 650; text-align: right; }
  .target-status.available { color: var(--sui-success); font-weight: 750; }
  .empty-state { padding: 22px; color: var(--sui-muted); background: var(--sui-bg); border-radius: 16px; box-shadow: var(--sui-inset); font-size: calc(10px * var(--text-scale)); text-align: center; }

  .move-route { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 12px; background: var(--sui-bg); border-radius: 16px; box-shadow: var(--sui-inset); }
  .route-node { display: grid; min-width: 0; gap: 4px; padding: 11px; background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-raised-sm); }
  .route-node small { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 750; letter-spacing: .12em; }
  .route-node strong, .route-node span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .route-node strong { color: var(--sui-text); font-size: calc(10px * var(--text-scale)); }
  .route-node span { color: var(--sui-muted); font-size: calc(8px * var(--text-scale)); }
  .route-arrow { color: var(--sui-primary); font-size: 20px; }
  .space-preservation { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
  .space-preservation > span { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; column-gap: 8px; padding: 10px; background: var(--sui-bg); border-radius: 13px; box-shadow: var(--sui-raised-sm); }
  .space-preservation b { display: grid; grid-row: span 2; width: 30px; height: 30px; color: var(--sui-primary); background: var(--sui-bg); border-radius: 9px; box-shadow: var(--sui-inset-sm); place-items: center; }
  .space-preservation strong, .space-preservation small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .space-preservation strong { color: var(--sui-text); font-size: calc(9px * var(--text-scale)); }
  .space-preservation small { margin-top: 3px; color: var(--sui-muted); font-size: calc(7px * var(--text-scale)); }
  .transfer-progress { display: grid; gap: 8px; padding: 12px 13px; background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-inset); }
  .progress-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--sui-muted); font-size: calc(9px * var(--text-scale)); }
  .progress-heading strong { color: var(--sui-primary); font-size: calc(13px * var(--text-scale)); }
  .progress-track { height: 9px; overflow: hidden; background: var(--sui-bg); border-radius: 99px; box-shadow: var(--sui-inset-sm); }
  .progress-track span { display: block; width: 0; height: 100%; background: var(--sui-primary); border-radius: inherit; transition: width 180ms ease; }
  .transfer-progress small { color: var(--sui-muted); font-size: calc(8px * var(--text-scale)); }
  .transfer-state { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 11px; color: var(--sui-muted); background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-inset-sm); font-size: calc(9px * var(--text-scale)); }
  .status-ready, .status-live { width: 8px; height: 8px; border-radius: 50%; }
  .status-ready { background: var(--sui-success); }
  .status-live { background: var(--sui-primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-primary) 16%, transparent); }
  .dialog-error { margin: 0; padding: 10px 12px; color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); border-radius: 11px; box-shadow: var(--sui-inset-sm); font-size: calc(9px * var(--text-scale)); line-height: 1.45; }

  .storage-dialog > footer { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 20px; background: var(--sui-bg); border-top: 1px solid color-mix(in srgb, var(--sui-shadow) 22%, transparent); }
  .storage-dialog > footer > span { display: flex; align-items: center; gap: 7px; color: var(--sui-muted); font-size: calc(9px * var(--text-scale)); }
  .storage-dialog > footer > div { display: flex; gap: 8px; }
  .storage-dialog footer button { height: 36px; padding: 0 15px; border: 0; border-radius: 10px; font: inherit; font-size: calc(11px * var(--text-scale)); font-weight: 650; cursor: pointer; box-shadow: var(--sui-raised-sm); transition: transform 120ms ease, box-shadow 120ms ease, color 120ms ease, background 120ms ease; }
  .cancel { color: var(--sui-text); background: var(--sui-bg); }
  .cancel:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); }
  .cancel:active:not(:disabled) { color: var(--sui-primary); transform: translateY(1px); box-shadow: var(--sui-inset-sm); }
  .cancel:disabled { cursor: default; opacity: .62; }
  .save { display: flex; align-items: center; gap: 7px; color: #fff; background: var(--sui-primary); box-shadow: 4px 4px 12px color-mix(in srgb, var(--sui-primary) 30%, transparent) !important; }
  .save:hover:not(:disabled) { background: var(--sui-primary-hover); transform: translateY(-1px); }
  .save:active:not(:disabled) { transform: translateY(1px); box-shadow: var(--sui-inset-sm) !important; }
  .storage-dialog button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 50%, transparent); outline-offset: 3px; }

  @keyframes move-fade { from { opacity: 0; } }
  @keyframes move-enter { from { opacity: 0; transform: translateY(8px) scale(.985); } }
  @media (max-width: 620px) {
    .storage-modal { padding: 18px; }
    .storage-dialog { width: min(100%, 520px); max-height: calc(100% - 18px); }
    .space-preservation { grid-template-columns: 1fr; }
    .storage-dialog > footer { align-items: stretch; flex-direction: column; }
    .storage-dialog > footer > div { justify-content: flex-end; }
  }
  @media (prefers-reduced-motion: reduce) { .storage-modal *, .storage-modal *::before, .storage-modal *::after { animation: none !important; transition: none !important; } }
</style>
