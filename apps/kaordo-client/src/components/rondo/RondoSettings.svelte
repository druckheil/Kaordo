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
  .settings-shell { display: grid; grid-template-columns: 214px minmax(0, 1fr); min-width: 0; min-height: 0; color: #354139; background: var(--canvas); }
  .settings-nav { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; padding: 18px 12px 14px; background: #eef2ee; border-right: 1px solid #d8dfda; }
  .settings-nav header { display: grid; gap: 4px; padding: 2px 8px 21px; }
  .settings-nav header span { color: #89948d; font-size: calc(8px * var(--text-scale)); font-weight: 740; letter-spacing: .12em; text-transform: uppercase; }
  .settings-nav header strong { overflow: hidden; color: #37443d; font-size: calc(13px * var(--text-scale)); font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
  .settings-nav nav { display: grid; align-content: start; gap: 4px; }
  .settings-nav nav button { height: 37px; padding: 0 11px; color: #68756d; background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 620; text-align: left; }
  .settings-nav nav button:hover { background: rgb(255 255 255 / 60%); }
  .settings-nav nav button.active { color: #356a59; background: #dceae3; font-weight: 700; }
  .nav-note { padding: 13px 8px 2px; color: #909a94; border-top: 1px solid #d8ded9; font-size: calc(8px * var(--text-scale)); }
  .nav-note span { color: #5d6b63; font-weight: 700; }
  .settings-content { display: grid; grid-template-rows: 56px minmax(0, 1fr); min-width: 0; min-height: 0; }
  .settings-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0 18px; background: rgb(255 255 255 / 72%); border-bottom: 1px solid #dce2dd; }
  .settings-toolbar div { display: flex; align-items: baseline; gap: 9px; }
  .settings-toolbar div span { color: #929c96; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .settings-toolbar div strong { color: #39463f; font-size: calc(11px * var(--text-scale)); font-weight: 700; }
  .settings-toolbar > button { display: grid; width: 32px; height: 32px; padding: 0; color: #718078; background: #f4f7f4; border: 1px solid #d6ddd8; border-radius: 9px; cursor: pointer; place-items: center; }
  .settings-toolbar svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.5; }
  .settings-scroll { min-height: 0; padding: 38px clamp(28px, 5vw, 68px) 70px; overflow-y: auto; }
  .settings-section { width: min(760px, 100%); margin: 0 auto; }
  .section-copy > span { color: var(--accent); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .13em; text-transform: uppercase; }
  .section-copy h2 { margin-top: 8px; color: #29362f; font-size: calc(25px * var(--text-scale)); font-weight: 680; letter-spacing: -.035em; }
  .section-copy p { margin-top: 8px; color: #7c8780; font-size: calc(11px * var(--text-scale)); line-height: 1.55; }
  .settings-card { margin-top: 24px; padding: 20px; background: rgb(255 255 255 / 80%); border: 1px solid #d7ded9; border-radius: 16px; box-shadow: 0 12px 30px rgb(41 65 56 / 6%); }
  .general-form { display: grid; gap: 17px; }
  label { display: grid; gap: 7px; color: #59665e; font-size: calc(9px * var(--text-scale)); font-weight: 680; }
  input, textarea, select { width: 100%; color: #2d3932; background: #fafcf9; border: 1px solid #cfd8d2; border-radius: 10px; outline: none; font-size: calc(10px * var(--text-scale)); }
  input, select { height: 39px; padding: 0 11px; }
  textarea { padding: 10px 11px; resize: vertical; line-height: 1.5; }
  input:focus, textarea:focus, select:focus { border-color: #72a18f; box-shadow: 0 0 0 3px rgb(70 126 106 / 9%); }
  input:disabled, textarea:disabled { opacity: .7; }
  label small { color: #929c96; font-size: calc(8px * var(--text-scale)); font-weight: 540; }
  .primary { justify-self: end; height: 37px; padding: 0 15px; color: #f7fbf9; background: var(--accent); border: 1px solid #2f6a5b; border-radius: 9px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 690; }
  button:disabled { cursor: not-allowed !important; opacity: .5; }
  .read-only-note { margin-top: 13px; color: #8b958f; font-size: calc(9px * var(--text-scale)); }
  .settings-error { width: min(760px, 100%); margin: 0 auto 18px; padding: 10px 12px; color: #9d4b41; background: #fff1ef; border: 1px solid #edc8c1; border-radius: 10px; font-size: calc(9px * var(--text-scale)); }
  .invite-builder { display: grid; grid-template-columns: minmax(150px, .8fr) minmax(150px, .8fr) auto; align-items: end; gap: 13px; }
  .item-list, .priority-list { display: grid; gap: 8px; margin-top: 19px; }
  .invite-row, .room-row, .node-tier { display: grid; align-items: center; gap: 12px; min-height: 64px; padding: 11px 13px; background: rgb(255 255 255 / 65%); border: 1px solid #dbe1dc; border-radius: 13px; }
  .invite-row { grid-template-columns: 38px minmax(0, 1fr) auto auto; }
  .room-row { grid-template-columns: 38px minmax(0, 1fr) auto; }
  .item-icon { display: grid; width: 36px; height: 36px; color: #5a8979; background: #e8f1ed; border-radius: 11px; place-items: center; }
  .item-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.45; }
  .invite-row div, .room-row div { display: grid; gap: 3px; min-width: 0; }
  .invite-row strong, .room-row strong, .node-copy strong { overflow: hidden; color: #3a473f; font-size: calc(10px * var(--text-scale)); font-weight: 690; text-overflow: ellipsis; white-space: nowrap; }
  .invite-row div span, .room-row div span, .node-copy > span { color: #87918b; font-size: calc(8px * var(--text-scale)); }
  .invite-row button, .room-row button, .node-actions button { height: 30px; padding: 0 9px; color: #627068; background: #f4f7f4; border: 1px solid #d4dcd6; border-radius: 8px; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 650; }
  button.danger { color: #a55247; background: #fff5f3; border-color: #eccfc9; }
  .empty-list { padding: 28px; color: #929b96; background: rgb(255 255 255 / 44%); border: 1px dashed #d6ddd8; border-radius: 13px; font-size: calc(9px * var(--text-scale)); text-align: center; }
  .inline-create { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 13px; }
  .room-number { color: #8d9891; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: calc(9px * var(--text-scale)); font-weight: 700; text-align: center; }
  .node-tier { grid-template-columns: 46px minmax(0, 1fr) auto; min-height: 78px; padding: 12px 14px; }
  .priority-index { display: grid; position: relative; width: 40px; height: 40px; color: #456d5f; background: #e5efea; border-radius: 12px; font-size: calc(11px * var(--text-scale)); font-weight: 760; place-items: center; }
  .priority-index i { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; background: #56a17f; border: 2px solid #fff; border-radius: 50%; }
  .priority-index i.offline { background: #b86a60; }
  .node-copy { display: grid; gap: 4px; min-width: 0; }
  .node-meter { height: 4px; margin-top: 3px; overflow: hidden; background: #e3e9e5; border-radius: 999px; }
  .node-meter i { display: block; height: 100%; background: linear-gradient(90deg, #68a890, #3d7967); border-radius: inherit; }
  .node-actions { display: flex; gap: 5px; }
  .add-node { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 13px; }
  @media (max-width: 1120px) { .invite-builder { grid-template-columns: 1fr 1fr; } .invite-builder .primary { grid-column: 1 / -1; } }
</style>
