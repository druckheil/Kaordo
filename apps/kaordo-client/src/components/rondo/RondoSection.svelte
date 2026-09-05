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
      onPresentationChange={(preferences) => state.configurePresentation(preferences)}
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
  .rondo-shell {
    --rondo-bg: #e4e9f0;
    --rondo-bg-light: #edf1f7;
    --rondo-bg-dark: #d1d9e6;
    --rondo-surface: #e8edf4;
    --rondo-surface-strong: #eef2f8;
    --rondo-shadow-color: rgb(39 51 67 / 20%);
    --rondo-shadow-raised: 6px 7px 16px var(--rondo-shadow-color), -5px -5px 13px rgb(255 255 255 / 56%);
    --rondo-shadow-raised-sm: 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%);
    --rondo-shadow-inset: inset 3px 3px 8px rgb(39 51 67 / 16%), inset -3px -3px 7px rgb(255 255 255 / 54%);
    --rondo-shadow-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 15%), inset -2px -2px 5px rgb(255 255 255 / 50%);
    --rondo-primary: #5b54e0;
    --rondo-primary-hover: #4a44c4;
    --rondo-success: #2d9f75;
    --rondo-danger: #c75b68;
    --rondo-text: #2d3748;
    --rondo-text-muted: #5c6d84;
    --rondo-text-light: #7b8ca3;
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--rondo-text);
    background:
      radial-gradient(circle at 75% 4%, rgb(91 84 224 / 8%), transparent 33%),
      var(--rondo-bg);
  }

  .rondo-loading, .rondo-empty {
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    margin: 16px 16px 16px 4px;
    padding: 42px;
    overflow: auto;
    color: var(--rondo-text);
    background: linear-gradient(145deg, var(--rondo-surface-strong), var(--rondo-surface));
    border-radius: 26px;
    box-shadow: var(--rondo-shadow-raised);
    text-align: center;
  }

  .rondo-loading { flex-direction: row; gap: 8px; }
  .rondo-loading span, .detail-loading span {
    width: 8px;
    height: 8px;
    background: var(--rondo-primary);
    border-radius: 50%;
    box-shadow: 0 0 0 4px rgb(91 84 224 / 12%);
    animation: pulse 900ms ease-in-out infinite alternate;
  }
  .rondo-loading span:nth-child(2), .detail-loading span:nth-child(2) { animation-delay: 150ms; }
  .rondo-loading span:nth-child(3), .detail-loading span:nth-child(3) { animation-delay: 300ms; }

  .detail-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    min-height: 0;
    color: var(--rondo-danger);
    background: transparent;
    font-size: calc(10px * var(--text-scale));
  }
  .detail-loading div { margin-right: 8px; }
  .detail-loading button {
    height: 34px;
    padding: 0 13px;
    color: var(--rondo-text-muted);
    background: var(--rondo-surface);
    border: 0;
    border-radius: 11px;
    box-shadow: var(--rondo-shadow-raised-sm);
    cursor: pointer;
    font-size: calc(9px * var(--text-scale));
    font-weight: 680;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }
  .detail-loading button:hover { color: var(--rondo-primary); transform: translateY(-1px); }
  .detail-loading button:active { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }

  .empty-orbit {
    position: relative;
    width: 82px;
    height: 82px;
    margin-bottom: 25px;
    background: var(--rondo-bg);
    border: 0;
    border-radius: 50%;
    box-shadow: var(--rondo-shadow-inset), var(--rondo-shadow-raised-sm);
  }
  .empty-orbit::before { position: absolute; inset: 14px; border: 1px dashed color-mix(in srgb, var(--rondo-primary) 35%, transparent); border-radius: 50%; content: ''; }
  .empty-orbit span { position: absolute; inset: 31px; background: linear-gradient(145deg, var(--rondo-primary), var(--rondo-primary-hover)); border-radius: 50%; box-shadow: 0 6px 14px rgb(74 68 196 / 25%); }
  .empty-orbit i { position: absolute; width: 11px; height: 11px; background: var(--rondo-surface-strong); border: 2px solid color-mix(in srgb, var(--rondo-primary) 58%, white); border-radius: 50%; box-shadow: var(--rondo-shadow-raised-sm); }
  .empty-orbit i:nth-child(1) { top: 3px; left: 35px; }
  .empty-orbit i:nth-child(2) { right: 3px; bottom: 15px; }
  .empty-orbit i:nth-child(3) { bottom: 15px; left: 3px; }
  .eyebrow { color: var(--rondo-primary); font-size: calc(9px * var(--text-scale)); font-weight: 780; letter-spacing: .15em; text-transform: uppercase; }
  h2 { margin-top: 11px; color: var(--rondo-text); font-size: calc(30px * var(--text-scale)); font-weight: 740; letter-spacing: -.045em; }
  p { max-width: 430px; margin-top: 11px; color: var(--rondo-text-muted); font-size: calc(12px * var(--text-scale)); line-height: 1.6; }
  .empty-actions { display: flex; gap: 10px; margin-top: 25px; }
  .empty-actions button, .retry {
    height: 40px;
    padding: 0 17px;
    color: var(--rondo-text-muted);
    background: var(--rondo-surface);
    border: 0;
    border-radius: 12px;
    box-shadow: var(--rondo-shadow-raised-sm);
    cursor: pointer;
    font-size: calc(10px * var(--text-scale));
    font-weight: 700;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }
  .empty-actions button:hover, .retry:hover { color: var(--rondo-primary); transform: translateY(-1px); }
  .empty-actions button:active, .retry:active { box-shadow: var(--rondo-shadow-inset-sm); transform: none; }
  .empty-actions .primary { color: #fff; background: linear-gradient(145deg, var(--rondo-primary), var(--rondo-primary-hover)); box-shadow: 5px 6px 13px rgb(74 68 196 / 25%), -3px -3px 8px rgb(255 255 255 / 45%); }
  .empty-actions .primary:hover { color: #fff; }
  .load-error { margin-top: 18px; color: var(--rondo-danger); font-size: calc(10px * var(--text-scale)); }
  .retry { margin-top: 10px; }

  :global(html[data-theme='dark']) .rondo-shell {
    --rondo-bg: #2a2d35;
    --rondo-bg-light: #31343c;
    --rondo-bg-dark: #23262d;
    --rondo-surface: #2d3038;
    --rondo-surface-strong: #343740;
    --rondo-shadow-color: rgb(0 0 0 / 42%);
    --rondo-shadow-raised: 7px 8px 18px var(--rondo-shadow-color);
    --rondo-shadow-raised-sm: 4px 5px 11px var(--rondo-shadow-color);
    --rondo-shadow-inset: inset 3px 3px 8px var(--rondo-shadow-color), inset -3px -3px 7px rgb(255 255 255 / 4%);
    --rondo-shadow-inset-sm: inset 2px 2px 6px var(--rondo-shadow-color), inset -2px -2px 5px rgb(255 255 255 / 4%);
    --rondo-primary: #9b95ff;
    --rondo-primary-hover: #b2adff;
    --rondo-success: #54c99a;
    --rondo-danger: #e28a9e;
    --rondo-text: #e2e8f0;
    --rondo-text-muted: #aab4c5;
    --rondo-text-light: #8591a5;
    color: var(--rondo-text);
    background: var(--rondo-bg);
  }

  @keyframes pulse { from { opacity: .38; transform: translateY(2px); } to { opacity: 1; transform: translateY(-2px); } }

  @media (max-width: 720px) {
    .rondo-shell { grid-template-columns: 68px minmax(0, 1fr); }
    .rondo-loading, .rondo-empty { margin: 10px 10px 10px 2px; padding: 28px 18px; border-radius: 22px; }
    .empty-actions { flex-wrap: wrap; justify-content: center; }
  }
</style>
