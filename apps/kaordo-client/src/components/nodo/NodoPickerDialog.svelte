<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodoNode, PublicNodoStorage } from '../../lib/domain/nodo';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    busy?: boolean;
    description: string;
    nodes: readonly NodoNode[];
    onClose: () => void;
    onSave: (nodeId: string) => Promise<boolean> | boolean;
    publicNodeId: string;
    publicStorage: PublicNodoStorage | null;
    selectedNodeId: string;
    title: string;
  };

  let {
    busy = false,
    description,
    nodes,
    onClose,
    onSave,
    publicNodeId,
    publicStorage,
    selectedNodeId,
    title,
  }: Props = $props();
  let dialog = $state<HTMLElement>();
  let draftNodeId = $state('');
  let pressedNodeId = $state<string | null>(null);
  let privateNodes = $derived(nodes.filter(({ spaces }) => spaces.private.quotaBytes > 0));
  let selectedPrivate = $derived(privateNodes.find(({ id }) => id === draftNodeId));
  let selectedQuotaBytes = $derived(draftNodeId === publicNodeId
    ? publicStorage?.limitBytes ?? 1_073_741_824
    : selectedPrivate?.spaces.private.quotaBytes ?? 1);
  let selectedUsedBytes = $derived(draftNodeId === publicNodeId
    ? (publicStorage?.usedBytes ?? 0) + (publicStorage?.reservedBytes ?? 0)
    : selectedPrivate?.spaces.private.usedBytes ?? 0);
  let storageFill = $derived(percent(selectedUsedBytes, selectedQuotaBytes));

  onMount(() => {
    draftNodeId = selectedNodeId;
    dialog?.focus();
  });

  async function save() {
    if (busy || !destinationAvailable(draftNodeId)) return;
    if (await onSave(draftNodeId)) onClose();
  }

  function destinationAvailable(id: string): boolean {
    if (id === publicNodeId) return Boolean(publicStorage?.nodeCandidates.length);
    const node = privateNodes.find((item) => item.id === id);
    return Boolean(node?.online && node.policy.allowUploads &&
      node.spaces.private.usedBytes < node.spaces.private.quotaBytes);
  }

  function selectDestination(id: string): void {
    if (destinationAvailable(id)) draftNodeId = id;
  }

  function pressDestination(id: string, event: PointerEvent): void {
    if (!destinationAvailable(id)) return;
    selectDestination(id);
    pressedNodeId = id;
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function releaseDestination(id: string): void {
    if (pressedNodeId === id) pressedNodeId = null;
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
  <button class="backdrop" type="button" aria-label="Close Nodo picker" onclick={onClose}></button>
  <div bind:this={dialog} class="storage-dialog" role="dialog" aria-modal="true"
    aria-labelledby="nodo-picker-title" tabindex="-1" onkeydown={keydown}>
    <header>
      <span class="cassette" aria-hidden="true">
        <svg viewBox="0 0 28 28"><rect x="4" y="4.5" width="20" height="19" rx="3"/><circle cx="10" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M8 21l2-5h8l2 5M10 12h8"/></svg>
      </span>
      <div><small>NODO STORAGE</small><h2 id="nodo-picker-title">{title}</h2></div>
      <button class="close" type="button" aria-label="Close" disabled={busy} onclick={onClose}>×</button>
    </header>

    <div class="content">
      <div class="intro"><strong>Choose where this content lives</strong><p>{description}</p></div>
      <div class="destinations">
        <button type="button" class:selected={draftNodeId === publicNodeId} class:pressed={pressedNodeId === publicNodeId}
          aria-label="Public Nodo, shared 1 GB reserve"
          disabled={!destinationAvailable(publicNodeId)}
          onpointerdown={(event) => pressDestination(publicNodeId, event)}
          onpointerup={() => releaseDestination(publicNodeId)}
          onpointercancel={() => releaseDestination(publicNodeId)}
          onlostpointercapture={() => releaseDestination(publicNodeId)}
          onclick={() => selectDestination(publicNodeId)}>
          <span class="node-icon public">◎</span>
          <span class="node-copy"><strong>Public Nodo</strong><small>Shared 1 GB reserve</small></span>
          <i>{draftNodeId === publicNodeId ? '✓' : ''}</i>
        </button>
        {#each privateNodes as node (node.id)}
          <button type="button" class:selected={draftNodeId === node.id} class:pressed={pressedNodeId === node.id}
            aria-label={`${node.deviceName}, ${node.online ? 'Private Nodo' : 'Offline'}`}
            disabled={!destinationAvailable(node.id)}
            onpointerdown={(event) => pressDestination(node.id, event)}
            onpointerup={() => releaseDestination(node.id)}
            onpointercancel={() => releaseDestination(node.id)}
            onlostpointercapture={() => releaseDestination(node.id)}
            onclick={() => selectDestination(node.id)}>
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
    </div>

    <footer>
      <span><i style={`background:${meterColor(storageFill)}`}></i>{Math.round(storageFill)}% currently used</span>
      <div><button class="cancel" type="button" disabled={busy} onclick={onClose}>Cancel</button><button class="save" type="button" disabled={busy || !destinationAvailable(draftNodeId)} onclick={save}>{#if busy}<LoadingSpinner compact />{/if}{busy ? 'Saving…' : 'Save'}</button></div>
    </footer>
  </div>
</div>

<style>
  .storage-modal{position:fixed;inset:0;z-index:120;display:grid;padding:32px;place-items:center}.backdrop{position:absolute;inset:0;width:100%;height:100%;padding:0;background:rgb(10 20 17 / 48%);border:0;backdrop-filter:blur(5px);animation:fade 150ms ease-out both}.storage-dialog{position:relative;width:min(560px,calc(100vw - 56px));max-height:calc(100vh - 64px);overflow:auto;color:var(--ink);background:var(--panel-soft);border:1px solid color-mix(in srgb,var(--line) 65%,white);border-radius:22px;box-shadow:0 28px 80px rgb(8 24 19 / 30%);outline:0;animation:enter 180ms cubic-bezier(.2,.8,.2,1) both}.storage-dialog>header{display:flex;align-items:center;gap:13px;padding:18px 20px;background:color-mix(in srgb,var(--panel) 88%,var(--accent) 12%);border-bottom:1px solid var(--line)}.cassette{display:grid;width:44px;height:44px;color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 24%,var(--line));border-radius:13px;place-items:center}.cassette svg{width:26px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5}.storage-dialog header div{display:grid;gap:3px}.storage-dialog header small,.intro p{color:var(--muted)}.storage-dialog header small,.meter-heading small{font-size:calc(9px * var(--text-scale));font-weight:750;letter-spacing:.12em}.storage-dialog h2{margin:0;font-size:calc(19px * var(--text-scale));letter-spacing:-.03em}.close{margin-left:auto;width:34px;height:34px;color:var(--muted);background:transparent;border:0;border-radius:10px;font-size:22px;cursor:pointer}.close:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 7%,transparent)}.content{display:grid;gap:16px;padding:20px}.intro{display:grid;gap:4px}.intro strong{font-size:calc(13px * var(--text-scale))}.intro p{margin:0;font-size:calc(11px * var(--text-scale));line-height:1.5}.destinations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.destinations button{display:flex;align-items:center;gap:10px;min-width:0;padding:11px;color:var(--ink);text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:13px;cursor:pointer;transition:transform 120ms ease,border-color 120ms ease,background 120ms ease}.destinations button:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 36%,var(--line))}.destinations button.selected{background:color-mix(in srgb,var(--accent) 9%,var(--panel));border-color:color-mix(in srgb,var(--accent) 48%,var(--line));box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 8%,transparent)}.destinations button:disabled{cursor:default;opacity:.46}.node-icon{display:grid;flex:none;width:34px;height:34px;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel));border-radius:10px;place-items:center}.node-icon.public{font-size:21px}.node-copy{display:grid;min-width:0;gap:3px}.node-copy strong,.node-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node-copy strong{font-size:calc(11px * var(--text-scale))}.node-copy small{color:var(--muted);font-size:calc(9px * var(--text-scale))}.destinations button>i{margin-left:auto;color:var(--accent);font-style:normal;font-weight:800}.meter-card{padding:15px;background:var(--panel);border:1px solid var(--line);border-radius:15px}.meter-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.meter-heading span{display:grid;gap:4px}.meter-heading strong{font-size:calc(12px * var(--text-scale))}.meter-heading b{font-size:calc(18px * var(--text-scale))}.meter{height:7px;margin-top:12px;overflow:hidden;background:color-mix(in srgb,var(--muted) 13%,transparent);border-radius:999px}.meter i{display:block;height:100%;border-radius:inherit;transition:width 180ms ease,background 180ms ease}.storage-dialog>footer{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 20px;background:var(--panel);border-top:1px solid var(--line)}.storage-dialog>footer>span{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:calc(9px * var(--text-scale))}.storage-dialog>footer>span i{width:8px;height:8px;border-radius:50%}.storage-dialog>footer>div{display:flex;gap:8px}.storage-dialog footer button{height:36px;padding:0 15px;border-radius:10px;font:inherit;font-size:calc(11px * var(--text-scale));font-weight:650;cursor:pointer}.cancel{color:var(--ink);background:transparent;border:1px solid var(--line-strong)}.save{display:flex;align-items:center;gap:7px;color:white;background:var(--accent);border:1px solid var(--accent)}.storage-dialog footer button:disabled{cursor:default;opacity:.5}@keyframes fade{from{opacity:0}}@keyframes enter{from{opacity:0;transform:translateY(8px) scale(.985)}}@media(max-width:620px){.destinations{grid-template-columns:1fr}.storage-dialog>footer{align-items:stretch;flex-direction:column}.storage-dialog>footer>div{justify-content:flex-end}}
  /* SoftUI-compatible neumorphic surface. The tokens intentionally inherit
     Kaordo's active theme and accent rather than introducing a second palette. */
  .storage-modal {
    --app-header-height: 32px;
    inset: var(--app-header-height) 0 0;
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow-light: #fff;
    --sui-shadow-dark: #b8c0cc;
    --sui-primary: #5b54e0;
    --sui-text: #2d3748;
    --sui-muted: #5a6a7e;
    --sui-raised: 6px 6px 14px var(--sui-shadow-dark), -6px -6px 14px var(--sui-shadow-light);
    --sui-raised-sm: 3px 3px 8px var(--sui-shadow-dark), -3px -3px 8px var(--sui-shadow-light);
    --sui-raised-lg: 10px 10px 20px var(--sui-shadow-dark), -10px -10px 20px var(--sui-shadow-light);
    --sui-inset: inset 3px 3px 8px var(--sui-shadow-dark), inset -3px -3px 8px var(--sui-shadow-light);
    --sui-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark), inset -2px -2px 5px var(--sui-shadow-light);
  }

  :global(html[data-theme='dark']) .storage-modal {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow-light: #33363f;
    --sui-shadow-dark: #1e2027;
    --sui-primary: var(--accent, #69a993);
    --sui-text: #e2e8f0;
    --sui-muted: #9ba5b8;
  }
  .storage-modal .backdrop { background: color-mix(in srgb, var(--chrome, #1c2825) 38%, transparent); }
  .storage-dialog {
    z-index: 2;
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: 24px;
    box-shadow: 0 24px 60px rgb(17 24 39 / 24%);
  }
  .storage-dialog > header { padding: 12px 18px; background: var(--sui-bg); border-bottom: 1px solid color-mix(in srgb, var(--sui-shadow-dark) 22%, transparent); }
  .cassette { color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: 13px; box-shadow: var(--sui-inset-sm); }
  .storage-dialog header small, .intro p, .node-copy small, .storage-dialog > footer > span { color: var(--sui-muted); }
  .close { color: var(--sui-muted); background: var(--sui-bg); border: 0; border-radius: 50%; box-shadow: var(--sui-raised-sm); }
  .close:hover { color: var(--sui-primary); background: var(--sui-bg); box-shadow: var(--sui-inset-sm); }
  .destinations button {
    color: var(--sui-text);
    background: var(--sui-bg);
    border: 0;
    border-radius: 16px;
    box-shadow: var(--sui-raised-sm);
    outline: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 120ms ease, box-shadow 120ms ease, color 120ms ease;
  }
  .destinations button:hover:not(:disabled) { color: var(--sui-primary); border-color: transparent; box-shadow: var(--sui-raised-sm); }
  .destinations button.selected,
  .destinations button.selected:hover:not(:disabled) {
    color: var(--sui-primary);
    background: var(--sui-bg);
    border-color: transparent;
    box-shadow: var(--sui-inset-sm);
    transform: translateY(1px);
    transition: box-shadow 110ms ease, transform 110ms ease, color 110ms ease;
  }
  .destinations button.pressed:not(:disabled),
  .destinations button.pressed:hover:not(:disabled),
  .destinations button.pressed:active:not(:disabled) { color: var(--sui-primary); box-shadow: var(--sui-inset); transform: translateY(2px) scale(.99); transition: none; }
  .destinations button:active:not(:disabled) { color: var(--sui-primary); }
  .destinations button:focus:not(:focus-visible) { outline: none; }
  .destinations button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 50%, transparent); outline-offset: 3px; }
  .node-icon { color: var(--sui-primary); background: var(--sui-bg); box-shadow: var(--sui-inset-sm); }
  .destinations button > i { color: var(--sui-primary); }
  .meter-card { background: var(--sui-bg); border: 0; border-radius: 16px; box-shadow: var(--sui-inset); }
  .meter { background: color-mix(in srgb, var(--sui-muted) 14%, transparent); }
  .storage-dialog > footer { background: var(--sui-bg); border-top: 1px solid color-mix(in srgb, var(--sui-shadow-dark) 22%, transparent); }
  .cancel, .save { border: 0 !important; box-shadow: var(--sui-raised-sm); transition: transform 120ms ease, box-shadow 120ms ease, color 120ms ease, background 120ms ease; }
  .cancel { color: var(--sui-text); background: var(--sui-bg); }
  .cancel:hover:not(:disabled) { color: var(--sui-primary); transform: translateY(-1px); box-shadow: var(--sui-raised-sm); }
  .cancel:active:not(:disabled) { color: var(--sui-primary); transform: translateY(1px); box-shadow: var(--sui-inset-sm); }
  .save { color: #fff; background: var(--sui-primary); border-color: var(--sui-primary) !important; box-shadow: 4px 4px 12px rgb(48 34 68 / 28%) !important; outline: none; -webkit-appearance: none; appearance: none; -webkit-tap-highlight-color: transparent; }
  .save:hover:not(:disabled) { background: color-mix(in srgb, var(--sui-primary) 84%, black); transform: translateY(-1px); box-shadow: 5px 5px 14px rgb(48 34 68 / 32%) !important; }
  .save:focus:not(:focus-visible) { outline: none; }
  .save:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 50%, transparent); outline-offset: 3px; box-shadow: 4px 4px 12px rgb(48 34 68 / 28%) !important; }
  .save:active:not(:disabled) { background: color-mix(in srgb, var(--sui-primary) 72%, black); transform: translateY(1px); box-shadow: inset 2px 2px 5px rgb(0 0 0 / 30%) !important; }

</style>
