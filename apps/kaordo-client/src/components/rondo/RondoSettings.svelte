<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { RondoPrivateNode, RondoSpaceDetail } from '../../lib/domain/rondo';
  import type { RondoGState, RondoOperation } from '../../lib/states/RondoGState';

  type Props = {
    detail: RondoSpaceDetail;
    error: string | null;
    onClose: () => void;
    operation: RondoOperation | null;
    privateNodes: RondoPrivateNode[];
    publicOption: { alreadyCreated: boolean; available: boolean; limitBytes: number };
    rondoState: RondoGState;
  };

  let { detail, error, onClose, operation, privateNodes, publicOption, rondoState }: Props = $props();
  let section = $state<'general' | 'invites' | 'nodes' | 'rooms'>('general');
  let name = $state('');
  let description = $state('');
  let roomName = $state('');
  let expiresInDays = $state(7);
  let maxUses = $state(0);
  let addTarget = $state('');
  let copiedId = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let initializedSpaceId = '';
  let isOwner = $derived(detail.role === 'owner');
  let assignedPrivateNodeIds = $derived(new Set(
    detail.nodes.filter(({ kind }) => kind === 'private').map(({ nodeId }) => nodeId).filter(Boolean),
  ));
  let availablePrivateNodes = $derived(
    privateNodes.filter(({ nodeId }) => !assignedPrivateNodeIds.has(nodeId)),
  );
  let canAddPublic = $derived(!detail.nodes.some(({ kind }) => kind === 'public') && publicOption.available);

  onDestroy(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  $effect(() => {
    if (initializedSpaceId === detail.id) return;
    initializedSpaceId = detail.id;
    name = detail.name;
    description = detail.description;
    section = 'general';
  });

  async function saveGeneral() {
    if (name.trim().length < 2) return;
    await rondoState.updateGeneral(name.trim(), description.trim());
  }

  async function createRoom() {
    if (!roomName.trim()) return;
    if (await rondoState.createRoom(roomName)) roomName = '';
  }

  async function addNode() {
    if (!addTarget) return;
    const added = addTarget === 'public'
      ? await rondoState.addNode({ storage: 'public' })
      : await rondoState.addNode({ nodeId: addTarget, storage: 'private' });
    if (added) addTarget = '';
  }

  async function copyInvite(id: string, code: string | null) {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedId = id;
    copiedTimer = setTimeout(() => {
      copiedId = null;
      copiedTimer = null;
    }, 1_400);
  }

  function formatBytes(value: number): string {
    if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(value % 1_073_741_824 ? 1 : 0)} GB`;
    return `${Math.max(0, value / 1_048_576).toFixed(0)} MB`;
  }

  function inviteStatus(expiresAt: number | null): string {
    if (expiresAt === null) return 'Never expires';
    const days = Math.max(0, Math.ceil((expiresAt - Date.now() / 1000) / 86_400));
    return days === 0 ? 'Expires today' : `${days}d remaining`;
  }
</script>

<div class="settings-shell">
  <aside class="settings-nav">
    <header><span>Settings</span><strong>{detail.name}</strong></header>
    <nav aria-label="Space settings">
      <button class:active={section === 'general'} type="button" onclick={() => section = 'general'}>General</button>
      <button class:active={section === 'invites'} type="button" onclick={() => section = 'invites'}>Invites</button>
      <button class:active={section === 'rooms'} type="button" onclick={() => section = 'rooms'}>Rooms</button>
      <button class:active={section === 'nodes'} type="button" onclick={() => section = 'nodes'}>Nodo hierarchy</button>
    </nav>
    <div class="nav-note"><span>{detail.members.length}</span> members · <span>{detail.rooms.length}</span> rooms</div>
  </aside>

  <main class="settings-content">
    <header class="settings-toolbar">
      <div><span>Space settings</span><strong>{section === 'nodes' ? 'Nodo hierarchy' : section[0]?.toUpperCase() + section.slice(1)}</strong></div>
      <button type="button" aria-label="Close settings" onclick={onClose}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg>
      </button>
    </header>

    <div class="settings-scroll">
      {#if error}<div class="settings-error" role="alert">{error}</div>{/if}

      {#if section === 'general'}
        <section class="settings-section">
          <div class="section-copy"><span>Identity</span><h2>General</h2><p>The name and description shown to every Space member.</p></div>
          <div class="settings-card general-form">
            <label><span>Space name</span><input type="text" bind:value={name} maxlength="48" disabled={!isOwner} /></label>
            <label><span>Description</span><textarea bind:value={description} maxlength="180" rows="4" disabled={!isOwner}></textarea></label>
            {#if isOwner}<button class="primary" type="button" disabled={operation !== null || name.trim().length < 2} onclick={saveGeneral}>{operation === 'save-general' ? 'Saving…' : 'Save changes'}</button>{/if}
          </div>
          {#if !isOwner}<p class="read-only-note">Only the Space owner can change these settings.</p>{/if}
        </section>

      {:else if section === 'invites'}
        <section class="settings-section">
          <div class="section-copy"><span>Access</span><h2>Invite codes</h2><p>Create limited or permanent codes without exposing stored secrets.</p></div>
          {#if isOwner}
            <div class="invite-builder settings-card">
              <label><span>Expires</span><select bind:value={expiresInDays}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={0}>Never</option></select></label>
              <label><span>Maximum uses</span><input type="number" bind:value={maxUses} min="0" max="1000" /><small>0 means unlimited</small></label>
              <button class="primary" type="button" disabled={operation !== null} onclick={() => rondoState.createInvite(Number(expiresInDays), Number(maxUses))}>{operation === 'create-invite' ? 'Creating…' : 'Create invite'}</button>
            </div>
          {/if}
          <div class="item-list">
            {#each detail.invites as invite (invite.id)}
              <article class="invite-row">
                <span class="item-icon"><svg viewBox="0 0 20 20"><path d="M7.5 12.5 12.5 7m-7 1.5L4 10a3 3 0 0 0 4.2 4.2l1.5-1.5m.6-5.4 1.5-1.5A3 3 0 0 1 16 10l-1.5 1.5" /></svg></span>
                <div><strong>{invite.code ?? 'Protected invite'}</strong><span>{inviteStatus(invite.expiresAt)} · {invite.uses}{invite.maxUses ? `/${invite.maxUses}` : ''} uses</span></div>
                {#if invite.code}<button type="button" onclick={() => copyInvite(invite.id, invite.code)}>{copiedId === invite.id ? 'Copied' : 'Copy'}</button>{/if}
                {#if isOwner}<button class="danger" type="button" disabled={operation !== null} onclick={() => rondoState.revokeInvite(invite.id)}>Revoke</button>{/if}
              </article>
            {/each}
            {#if detail.invites.length === 0}<div class="empty-list">No active invite codes.</div>{/if}
          </div>
        </section>

      {:else if section === 'rooms'}
        <section class="settings-section">
          <div class="section-copy"><span>Structure</span><h2>Rooms</h2><p>Every room combines persistent text with an optional voice session.</p></div>
          {#if isOwner}
            <form class="inline-create settings-card" onsubmit={(event) => { event.preventDefault(); void createRoom(); }}>
              <label><span>New room</span><input type="text" bind:value={roomName} maxlength="48" placeholder="product-ideas" /></label>
              <button class="primary" type="submit" disabled={operation !== null || !roomName.trim()}>{operation === 'create-room' ? 'Creating…' : 'Add room'}</button>
            </form>
          {/if}
          <div class="item-list">
            {#each detail.rooms as room, index (room.id)}
              <article class="room-row">
                <span class="room-number">{String(index + 1).padStart(2, '0')}</span>
                <div><strong>#{room.name}</strong><span>Text and voice room</span></div>
                {#if isOwner}<button class="danger" type="button" disabled={operation !== null || detail.rooms.length <= 1} onclick={() => rondoState.deleteRoom(room.id)}>Delete</button>{/if}
              </article>
            {/each}
          </div>
        </section>

      {:else}
        <section class="settings-section nodes-section">
          <div class="section-copy"><span>Storage</span><h2>Nodo hierarchy</h2><p>Data fills the first Nodo, then continues downward in this exact order.</p></div>
          <div class="priority-list">
            {#each detail.nodes as node, index (node.id)}
              <article class="node-tier">
                <div class="priority-index"><span>{index + 1}</span><i class:offline={!node.online}></i></div>
                <div class="node-copy"><strong>{node.deviceName ?? 'Disconnected Nodo'}</strong><span>{node.kind === 'public' ? 'Public tier' : 'Private tier'} · {formatBytes(node.usedBytes)} of {formatBytes(node.limitBytes)}</span><div class="node-meter"><i style={`width:${node.limitBytes ? Math.min(100, node.usedBytes / node.limitBytes * 100) : 0}%`}></i></div></div>
                {#if isOwner}
                  <div class="node-actions">
                    <button type="button" aria-label="Move Nodo up" disabled={operation !== null || index === 0} onclick={() => rondoState.moveNode(node.id, -1)}>↑</button>
                    <button type="button" aria-label="Move Nodo down" disabled={operation !== null || index === detail.nodes.length - 1} onclick={() => rondoState.moveNode(node.id, 1)}>↓</button>
                    <button class="danger" type="button" disabled={operation !== null || detail.nodes.length <= 1} onclick={() => rondoState.removeNode(node.id)}>Remove</button>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
          {#if isOwner}
            <div class="add-node settings-card">
              <label><span>Add storage tier</span><select bind:value={addTarget}><option value="">Choose Nodo…</option>{#if canAddPublic}<option value="public">Public Node · up to 1 GB</option>{/if}{#each availablePrivateNodes as node (node.nodeId)}<option value={node.nodeId}>{node.deviceName} · {formatBytes(node.availableBytes)} available</option>{/each}</select></label>
              <button class="primary" type="button" disabled={operation !== null || !addTarget} onclick={addNode}>{operation === 'add-node' ? 'Adding…' : 'Add Nodo'}</button>
            </div>
            {#if !canAddPublic && availablePrivateNodes.length === 0}<p class="read-only-note">No additional Nodo storage is currently available.</p>{/if}
          {/if}
        </section>
      {/if}
    </div>
  </main>
</div>

<style>
  .settings-shell { display: grid; grid-template-columns: minmax(196px, 214px) minmax(0, 1fr); gap: 12px; min-width: 0; min-height: 0; padding: 14px 14px 14px 8px; color: var(--rondo-text, #2d3748); background: transparent; }
  .settings-nav, .settings-content { min-width: 0; min-height: 0; overflow: hidden; background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4)); border-radius: 21px; box-shadow: var(--rondo-shadow-raised, 6px 7px 16px rgb(39 51 67 / 20%), -5px -5px 13px rgb(255 255 255 / 56%)); }
  .settings-nav { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; padding: 18px 12px 14px; }
  .settings-nav header { display: grid; gap: 4px; padding: 2px 8px 21px; }
  .settings-nav header span { color: var(--rondo-primary, #5b54e0); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .13em; text-transform: uppercase; }
  .settings-nav header strong { overflow: hidden; color: var(--rondo-text, #2d3748); font-size: calc(13px * var(--text-scale)); font-weight: 760; text-overflow: ellipsis; white-space: nowrap; }
  .settings-nav nav { display: grid; align-content: start; gap: 6px; }
  .settings-nav nav button { height: 39px; padding: 0 12px; color: var(--rondo-text-muted, #5c6d84); background: transparent; border: 0; border-radius: 12px; box-shadow: none; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 650; text-align: left; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .settings-nav nav button:hover { color: var(--rondo-primary, #5b54e0); transform: translateX(1px); }
  .settings-nav nav button.active { color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg-dark, #d1d9e6); box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); font-weight: 760; }
  .settings-nav nav button:focus-visible, .settings-toolbar button:focus-visible, .item-list button:focus-visible, .node-actions button:focus-visible { outline: 2px solid color-mix(in srgb, var(--rondo-primary, #5b54e0) 48%, transparent); outline-offset: 2px; }
  .nav-note { padding: 13px 8px 2px; color: var(--rondo-text-light, #7b8ca3); border-top: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 20%, transparent); font-size: calc(8px * var(--text-scale)); }
  .nav-note span { color: var(--rondo-text-muted, #5c6d84); font-weight: 760; }
  .settings-content { display: grid; grid-template-rows: 62px minmax(0, 1fr); }
  .settings-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: transparent; border-bottom: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 18%, transparent); }
  .settings-toolbar div { display: flex; align-items: baseline; gap: 9px; }
  .settings-toolbar div span { color: var(--rondo-primary, #5b54e0); font-size: calc(8px * var(--text-scale)); font-weight: 760; }
  .settings-toolbar div strong { color: var(--rondo-text, #2d3748); font-size: calc(11px * var(--text-scale)); font-weight: 740; }
  .settings-toolbar > button { display: grid; width: 35px; height: 35px; padding: 0; color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm); cursor: pointer; place-items: center; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .settings-toolbar > button:hover { color: var(--rondo-primary, #5b54e0); transform: translateY(-1px); }
  .settings-toolbar > button:active { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }
  .settings-toolbar svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.5; }
  .settings-scroll { min-height: 0; padding: 34px clamp(24px, 5vw, 68px) 70px; overflow-y: auto; scrollbar-color: var(--rondo-bg-dark, #d1d9e6) transparent; }
  .settings-section { width: min(760px, 100%); margin: 0 auto; }
  .section-copy > span { color: var(--rondo-primary, #5b54e0); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .14em; text-transform: uppercase; }
  .section-copy h2 { margin-top: 8px; color: var(--rondo-text, #2d3748); font-size: calc(25px * var(--text-scale)); font-weight: 740; letter-spacing: -.04em; }
  .section-copy p { margin-top: 8px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(11px * var(--text-scale)); line-height: 1.55; }
  .settings-card { margin-top: 24px; padding: 20px; background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 17px; box-shadow: var(--rondo-shadow-raised-sm); }
  .general-form { display: grid; gap: 17px; }
  label { display: grid; gap: 7px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(9px * var(--text-scale)); font-weight: 700; }
  input, textarea, select { width: 100%; color: var(--rondo-text, #2d3748); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 11px; outline: none; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(10px * var(--text-scale)); }
  input, select { height: 40px; padding: 0 12px; }
  textarea { padding: 10px 12px; resize: vertical; line-height: 1.5; }
  input:focus, textarea:focus, select:focus { box-shadow: var(--rondo-shadow-inset-sm), 0 0 0 3px color-mix(in srgb, var(--rondo-primary, #5b54e0) 18%, transparent); }
  input:disabled, textarea:disabled { opacity: .7; }
  label small { color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); font-weight: 560; }
  .primary { justify-self: end; min-height: 38px; padding: 0 16px; color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border: 0; border-radius: 12px; box-shadow: 5px 6px 13px rgb(74 68 196 / 25%), -3px -3px 8px rgb(255 255 255 / 45%); cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 710; transition: box-shadow 140ms ease, transform 140ms ease; }
  .primary:hover:not(:disabled) { transform: translateY(-1px); }
  .primary:active:not(:disabled) { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }
  button:disabled { cursor: not-allowed !important; opacity: .5; }
  .read-only-note { margin-top: 13px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(9px * var(--text-scale)); }
  .settings-error { width: min(760px, 100%); margin: 0 auto 18px; padding: 10px 12px; color: var(--rondo-danger, #c75b68); background: color-mix(in srgb, var(--rondo-danger, #c75b68) 10%, var(--rondo-surface, #e8edf4)); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); }
  .invite-builder { display: grid; grid-template-columns: minmax(150px, .8fr) minmax(150px, .8fr) auto; align-items: end; gap: 13px; }
  .item-list, .priority-list { display: grid; gap: 10px; margin-top: 19px; }
  .invite-row, .room-row, .node-tier { display: grid; align-items: center; gap: 12px; min-height: 66px; padding: 11px 13px; background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 14px; box-shadow: var(--rondo-shadow-raised-sm); transition: transform 140ms ease, box-shadow 140ms ease; }
  .invite-row:hover, .room-row:hover, .node-tier:hover { transform: translateY(-1px); }
  .invite-row { grid-template-columns: 38px minmax(0, 1fr) auto auto; }
  .room-row { grid-template-columns: 38px minmax(0, 1fr) auto; }
  .item-icon { display: grid; width: 36px; height: 36px; color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg, #e4e9f0); border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm); place-items: center; }
  .item-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.45; }
  .invite-row div, .room-row div { display: grid; gap: 3px; min-width: 0; }
  .invite-row strong, .room-row strong, .node-copy strong { overflow: hidden; color: var(--rondo-text, #2d3748); font-size: calc(10px * var(--text-scale)); font-weight: 740; text-overflow: ellipsis; white-space: nowrap; }
  .invite-row div span, .room-row div span, .node-copy > span { color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); }
  .invite-row button, .room-row button, .node-actions button { min-height: 31px; padding: 0 10px; color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 10px; box-shadow: var(--rondo-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 690; transition: color 130ms ease, box-shadow 130ms ease; }
  .invite-row button:hover, .room-row button:hover, .node-actions button:hover { color: var(--rondo-primary, #5b54e0); }
  .invite-row button:active, .room-row button:active, .node-actions button:active { box-shadow: var(--rondo-shadow-inset-sm); }
  button.danger { color: var(--rondo-danger, #c75b68); }
  .empty-list { padding: 28px; color: var(--rondo-text-light, #7b8ca3); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 14px; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); text-align: center; }
  .inline-create { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 13px; }
  .room-number { color: var(--rondo-text-light, #7b8ca3); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: calc(9px * var(--text-scale)); font-weight: 720; text-align: center; }
  .node-tier { grid-template-columns: 46px minmax(0, 1fr) auto; min-height: 80px; padding: 12px 14px; }
  .priority-index { display: grid; position: relative; width: 40px; height: 40px; color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg, #e4e9f0); border-radius: 12px; box-shadow: var(--rondo-shadow-inset-sm); font-size: calc(11px * var(--text-scale)); font-weight: 760; place-items: center; }
  .priority-index i { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; background: var(--rondo-success, #2d9f75); border: 2px solid var(--rondo-surface, #e8edf4); border-radius: 50%; }
  .priority-index i.offline { background: var(--rondo-danger, #c75b68); }
  .node-copy { display: grid; gap: 4px; min-width: 0; }
  .node-meter { height: 5px; margin-top: 3px; overflow: hidden; background: var(--rondo-bg-dark, #d1d9e6); border-radius: 999px; box-shadow: var(--rondo-shadow-inset-sm); }
  .node-meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border-radius: inherit; }
  .node-actions { display: flex; gap: 6px; }
  .add-node { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 13px; }
  @media (max-width: 1120px) { .invite-builder { grid-template-columns: 1fr 1fr; } .invite-builder .primary { grid-column: 1 / -1; } }
  @media (max-width: 720px) { .settings-shell { grid-template-columns: 1fr; padding: 8px 8px 8px 4px; } .settings-nav { max-height: 210px; } .settings-nav nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .settings-scroll { padding: 26px 18px 42px; } .invite-row, .room-row, .node-tier { grid-template-columns: 36px minmax(0, 1fr); } .invite-row button, .room-row button, .node-actions { grid-column: 2; justify-content: flex-start; } .node-tier { grid-template-columns: 42px minmax(0, 1fr); } }
</style>
