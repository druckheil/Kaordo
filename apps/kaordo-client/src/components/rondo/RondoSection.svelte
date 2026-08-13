<script lang="ts">
  import type { RondoGState, RondoSnapshot } from '../../lib/states/RondoGState';
  import type { MediaSettingsSnapshot } from '../../lib/states/MediaSettingsGState';
  import RondoCreateForm from './RondoCreateForm.svelte';
  import RondoJoinForm from './RondoJoinForm.svelte';
  import RondoRail from './RondoRail.svelte';
  import RondoSettings from './RondoSettings.svelte';
  import RondoSpaceShell from './RondoSpaceShell.svelte';

  type Props = {
    media: Readonly<MediaSettingsSnapshot>;
    snapshot: Readonly<RondoSnapshot>;
    state: RondoGState;
  };
  let { media, snapshot, state }: Props = $props();
  let activeSpace = $derived(snapshot.spaces.find(({ id }) => id === snapshot.activeSpaceId) ?? null);
</script>

<section class="rondo-shell" aria-labelledby="rondo-title">
  <h1 id="rondo-title" class="visually-hidden">Rondo</h1>
  <RondoRail
    activeSpaceId={snapshot.activeSpaceId}
    onCreate={() => state.openCreate()}
    onJoin={() => state.openJoin()}
    onSelect={(spaceId) => state.selectSpace(spaceId)}
    spaces={snapshot.spaces}
  />

  {#if snapshot.phase === 'loading' && snapshot.spaces.length === 0}
    <main class="rondo-loading" aria-label="Loading Rondo"><span></span><span></span><span></span></main>
  {:else if snapshot.view === 'create'}
    <RondoCreateForm
      busy={snapshot.operation === 'create'}
      error={snapshot.error}
      onCancel={() => state.closeForm()}
      onCreate={async (input) => { await state.createSpace(input); }}
      privateNodes={snapshot.privateNodes}
      publicOption={snapshot.publicOption}
    />
  {:else if snapshot.view === 'join'}
    <RondoJoinForm
      busy={snapshot.operation === 'join'}
      error={snapshot.error}
      onCancel={() => state.closeForm()}
      onJoin={async (inviteCode) => { await state.joinSpace(inviteCode); }}
    />
  {:else if activeSpace && snapshot.detail && snapshot.settingsOpen}
    <RondoSettings
      detail={snapshot.detail}
      error={snapshot.error}
      onClose={() => state.closeSettings()}
      operation={snapshot.operation}
      privateNodes={snapshot.privateNodes}
      publicOption={snapshot.publicOption}
      rondoState={state}
    />
  {:else if activeSpace && snapshot.detail}
    <RondoSpaceShell
      activeRoomId={snapshot.activeRoomId}
      chatAtLatest={snapshot.chatAtLatest}
      chatError={snapshot.chatError}
      chatHasMore={snapshot.chatHasMore}
      chatMessages={snapshot.chatMessages}
      chatPhase={snapshot.chatPhase}
      chatSending={snapshot.chatSending}
      detail={snapshot.detail}
      {media}
      onDeleteMessage={(messageId) => state.deleteMessage(messageId)}
      onJoinVoice={() => state.joinVoice()}
      onLeaveVoice={() => state.leaveVoice()}
      onLoadOlder={() => state.loadOlderMessages()}
      onOpenSettings={() => state.openSettings()}
      onReturnLatest={() => state.openChat()}
      onRoomMode={(mode) => state.setRoomMode(mode)}
      onSelectRoom={(roomId) => state.selectRoom(roomId)}
      onSendMessage={(body) => state.sendMessage(body)}
      onToggleCamera={() => state.toggleCamera()}
      onToggleDeafen={() => state.toggleDeafen()}
      onToggleMute={() => state.toggleMute()}
      onToggleScreen={() => state.toggleScreen()}
      roomMode={snapshot.roomMode}
      voice={snapshot.voice}
    />
  {:else if activeSpace}
    <main class="detail-loading">
      {#if snapshot.error}
        <div role="alert">{snapshot.error}</div>
        <button type="button" onclick={() => state.loadSpace()}>Try again</button>
      {:else}
        <span></span><span></span><span></span>
      {/if}
    </main>
  {:else}
    <main class="rondo-empty">
      <div class="empty-orbit" aria-hidden="true"><i></i><i></i><i></i><span></span></div>
      <span class="eyebrow">Group communication</span>
      <h2>Your circles, in one place</h2>
      <p>Create a Space for your community or join one with an invite code.</p>
      {#if snapshot.error}
        <div class="load-error" role="alert">{snapshot.error}</div>
        <button class="retry" type="button" onclick={() => state.refresh()}>Try again</button>
      {/if}
      <div class="empty-actions">
        <button class="primary" type="button" onclick={() => state.openCreate()}>Create a Space</button>
        <button type="button" onclick={() => state.openJoin()}>Join with code</button>
      </div>
    </main>
  {/if}
</section>

<style>
  .rondo-shell { display: grid; grid-template-columns: 76px minmax(0, 1fr); min-width: 0; min-height: 0; background: var(--canvas); }
  .rondo-loading, .rondo-empty { display: flex; align-items: center; flex-direction: column; justify-content: center; min-width: 0; min-height: 0; padding: 42px; color: #39473f; background: radial-gradient(circle at 50% 44%, rgb(74 137 118 / 9%), transparent 28%), var(--canvas); text-align: center; }
  .detail-loading { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 0; color: #9b4d43; background: var(--canvas); font-size: calc(10px * var(--text-scale)); }
  .detail-loading span { width: 7px; height: 7px; background: #6e9e8e; border-radius: 50%; animation: pulse 900ms ease-in-out infinite alternate; }
  .detail-loading span:nth-child(2) { animation-delay: 150ms; }
  .detail-loading span:nth-child(3) { animation-delay: 300ms; }
  .detail-loading div { margin-right: 8px; }
  .detail-loading button { height: 32px; padding: 0 11px; color: #5c6961; background: #f6f8f5; border: 1px solid #d4dcd6; border-radius: 9px; cursor: pointer; font-size: calc(9px * var(--text-scale)); }
  .rondo-loading { flex-direction: row; gap: 6px; }
  .rondo-loading span { width: 7px; height: 7px; background: #6e9e8e; border-radius: 50%; animation: pulse 900ms ease-in-out infinite alternate; }
  .rondo-loading span:nth-child(2) { animation-delay: 150ms; }
  .rondo-loading span:nth-child(3) { animation-delay: 300ms; }
  .empty-orbit { position: relative; width: 72px; height: 72px; margin-bottom: 25px; border: 1px solid #ccdad3; border-radius: 50%; box-shadow: 0 16px 36px rgb(40 74 61 / 8%); }
  .empty-orbit::before { position: absolute; inset: 13px; border: 1px dashed #b6ccc2; border-radius: 50%; content: ''; }
  .empty-orbit span { position: absolute; inset: 28px; background: #4c8875; border-radius: 50%; }
  .empty-orbit i { position: absolute; width: 10px; height: 10px; background: #edf5f1; border: 2px solid #669785; border-radius: 50%; }
  .empty-orbit i:nth-child(1) { top: 4px; left: 30px; }
  .empty-orbit i:nth-child(2) { right: 4px; bottom: 13px; }
  .empty-orbit i:nth-child(3) { bottom: 13px; left: 4px; }
  .eyebrow { color: var(--accent); font-size: calc(9px * var(--text-scale)); font-weight: 760; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin-top: 11px; color: #26332c; font-size: calc(30px * var(--text-scale)); font-weight: 680; letter-spacing: -.04em; }
  p { max-width: 430px; margin-top: 11px; color: #748078; font-size: calc(12px * var(--text-scale)); line-height: 1.6; }
  .empty-actions { display: flex; gap: 9px; margin-top: 25px; }
  .empty-actions button, .retry { height: 38px; padding: 0 16px; color: #657169; background: rgb(255 255 255 / 72%); border: 1px solid #d2dbd5; border-radius: 10px; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 680; }
  .empty-actions .primary { color: #f7fbf9; background: var(--accent); border-color: #2f6a5b; box-shadow: 0 8px 18px rgb(46 102 84 / 15%); }
  .load-error { margin-top: 18px; color: #a14f44; font-size: calc(10px * var(--text-scale)); }
  .retry { margin-top: 10px; }
  @keyframes pulse { from { opacity: .35; transform: translateY(2px); } to { opacity: 1; transform: translateY(-2px); } }
</style>
