<script lang="ts">
  import type { RondoPresentationPreferences } from '../../lib/domain/mediaSettings';
  import type { RondoMessage, RondoSpaceDetail } from '../../lib/domain/rondo';
  import type { RondoVoiceSnapshot } from '../../lib/services/RondoVoiceSession';
  import type { MediaSettingsSnapshot } from '../../lib/states/MediaSettingsGState';
  import RondoChat from './RondoChat.svelte';
  import RondoVoiceRoom from './RondoVoiceRoom.svelte';
  import RondoVoiceAudio from './RondoVoiceAudio.svelte';

  type Props = {
    activeRoomId: string | null;
    chatAtLatest: boolean;
    chatError: string | null;
    chatHasMore: boolean;
    chatMessages: RondoMessage[];
    chatPhase: 'idle' | 'loading' | 'ready';
    chatSending: boolean;
    detail: RondoSpaceDetail;
    media: Readonly<MediaSettingsSnapshot>;
    onDeleteMessage: (messageId: string) => Promise<boolean>;
    onLoadOlder: () => Promise<void>;
    onJoinVoice: () => Promise<boolean>;
    onLeaveVoice: () => Promise<void>;
    onOpenSettings: () => void;
    onPresentationChange: (preferences: RondoPresentationPreferences) => void | Promise<void>;
    onReturnLatest: () => Promise<void>;
    onRoomMode: (mode: 'text' | 'voice') => void;
    onSelectRoom: (roomId: string) => void;
    onSendMessage: (body: string) => Promise<boolean>;
    onToggleCamera: () => Promise<void>;
    onToggleDeafen: () => void;
    onToggleMute: () => void;
    onToggleScreen: () => Promise<void>;
    roomMode: 'text' | 'voice';
    voice: RondoVoiceSnapshot;
  };

  let {
    activeRoomId, chatAtLatest, chatError, chatHasMore, chatMessages, chatPhase,
    chatSending, detail, media, onDeleteMessage, onJoinVoice, onLeaveVoice, onLoadOlder,
    onOpenSettings, onPresentationChange, onReturnLatest, onRoomMode, onSelectRoom, onSendMessage,
    onToggleCamera, onToggleDeafen, onToggleMute, onToggleScreen, roomMode, voice,
  }: Props = $props();
  let activeRoom = $derived(detail.rooms.find(({ id }) => id === activeRoomId) ?? detail.rooms[0] ?? null);
  let currentUsername = $derived(detail.members.find(({ self }) => self)?.username ?? (detail.role === 'owner' ? detail.owner.username : ''));
  let onlineMembers = $derived(detail.members.filter(({ online }) => online));
  let offlineMembers = $derived(detail.members.filter(({ online }) => !online));

  function initial(username: string): string { return username[0]?.toUpperCase() ?? '?'; }
</script>

<div class="space-shell">
  <aside class="rooms-panel" aria-label={`${detail.name} rooms`}>
    <header>
      <div>
        <span>Space</span>
        <strong>{detail.name}</strong>
      </div>
      <span class:offline={!detail.storage.online} class="node-state">
        <i></i>{detail.storage.online ? 'Online' : 'Offline'}
      </span>
    </header>

    <div class="rooms-heading">
      <span>Rooms</span>
      <small>{detail.rooms.length}</small>
    </div>
    <nav class="room-list" aria-label="Rooms">
      {#each detail.rooms as room (room.id)}
        <button
          type="button"
          class:active={room.id === activeRoom?.id}
          aria-current={room.id === activeRoom?.id ? 'page' : undefined}
          onclick={() => onSelectRoom(room.id)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6.5 4.5 5.5 15m8-10.5-1 10M3.5 8h13m-13 4h13" />
          </svg>
          <span>{room.name}</span>
          {#if room.id === activeRoom?.id && voice.participants.length}
            <i class="voice-count" title={`${voice.participants.length} in voice`}>{voice.participants.length}</i>
          {:else}<i class="voice-dot" title="Text and voice room"></i>{/if}
        </button>
      {/each}
    </nav>

    <div class="space-identity">
      <span class="identity-avatar">{initial(detail.owner.username)}</span>
      <div><strong>{detail.owner.username}</strong><span>{detail.role === 'owner' ? 'Space owner' : 'Member'}</span></div>
    </div>
  </aside>

  <main class="room-content">
    <header class="room-toolbar">
      <div>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.5 5.5 15m8-10.5-1 10M3.5 8h13m-13 4h13" /></svg>
        <strong>{activeRoom?.name ?? 'Room'}</strong>
        <span>Text · Voice</span>
      </div>
      <div class="toolbar-actions">
        {#if voice.phase === 'connected'}
          <div class="mode-switch" aria-label="Room view">
            <button class:active={roomMode === 'text'} type="button" onclick={() => onRoomMode('text')}>Text</button>
            <button class:active={roomMode === 'voice'} type="button" onclick={() => onRoomMode('voice')}>Voice {voice.participants.length}</button>
          </div>
        {:else}
          <button class="join-voice" disabled={voice.phase === 'joining'} title={voice.error ?? undefined} type="button" onclick={onJoinVoice}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10V8a6 6 0 0 1 12 0v2M4 10H3v4h3v-4H4Zm12 0h1v4h-3v-4h2Z" /></svg>
            {voice.phase === 'joining' ? 'Connecting…' : voice.participants.length ? `Join ${voice.participants.length} in voice` : 'Join voice'}
          </button>
        {/if}
        <button class="settings-button" type="button" onclick={onOpenSettings}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-4v2m0 10v2M3 10h2m10 0h2M5 5l1.4 1.4m7.2 7.2L15 15m0-10-1.4 1.4m-7.2 7.2L5 15" /></svg>
          {detail.role === 'owner' ? 'Space settings' : 'Space info'}
        </button>
      </div>
    </header>

    {#if activeRoom && roomMode === 'voice'}
      <RondoVoiceRoom
        onLeave={onLeaveVoice}
        {onToggleCamera}
        {onToggleDeafen}
        {onToggleMute}
        {onToggleScreen}
        {onPresentationChange}
        roomName={activeRoom.name}
        {voice}
      />
    {:else if activeRoom}
      <RondoChat
        atLatest={chatAtLatest}
        {currentUsername}
        error={chatError}
        hasMore={chatHasMore}
        messages={chatMessages}
        onDelete={onDeleteMessage}
        onLoadOlder={onLoadOlder}
        onReturnLatest={onReturnLatest}
        onSend={onSendMessage}
        owner={detail.role === 'owner'}
        phase={chatPhase}
        roomName={activeRoom.name}
        sending={chatSending}
      />
    {/if}
    <RondoVoiceAudio {media} {voice} />
  </main>

  <aside class="members-panel" aria-label="Space members">
    <header>
      <span>Members</span>
      <strong>{detail.members.length}</strong>
    </header>

    <section>
      <h3>Online — {onlineMembers.length}</h3>
      {#each onlineMembers as member (member.id)}
        <div class="member-row">
          <span class="member-avatar">{initial(member.username)}<i></i></span>
          <div><strong>{member.username}</strong><span>{member.role === 'owner' ? 'Owner' : 'Online'}</span></div>
        </div>
      {/each}
      {#if onlineMembers.length === 0}<p class="no-members">Nobody is online.</p>{/if}
    </section>

    {#if offlineMembers.length}
      <section>
        <h3>Offline — {offlineMembers.length}</h3>
        {#each offlineMembers as member (member.id)}
          <div class="member-row offline-member">
            <span class="member-avatar">{initial(member.username)}</span>
            <div><strong>{member.username}</strong><span>{member.role === 'owner' ? 'Owner' : 'Offline'}</span></div>
          </div>
        {/each}
      </section>
    {/if}
  </aside>
</div>

<style>
  .space-shell {
    display: grid;
    grid-template-columns: minmax(196px, 218px) minmax(0, 1fr) minmax(212px, 238px);
    gap: 12px;
    min-width: 0;
    min-height: 0;
    padding: 14px 14px 14px 8px;
    color: var(--rondo-text, #2d3748);
    background: transparent;
  }

  .rooms-panel, .members-panel, .room-content {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4));
    border: 0;
    border-radius: 21px;
    box-shadow: var(--rondo-shadow-raised, 6px 7px 16px rgb(39 51 67 / 20%), -5px -5px 13px rgb(255 255 255 / 56%));
  }

  .rooms-panel { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; }
  .rooms-panel > header { display: flex; align-items: center; justify-content: space-between; min-height: 70px; padding: 14px 15px; }
  .rooms-panel header div { display: grid; gap: 4px; min-width: 0; }
  .rooms-panel header div span { color: var(--rondo-primary, #5b54e0); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .13em; text-transform: uppercase; }
  .rooms-panel header strong { overflow: hidden; color: var(--rondo-text, #2d3748); font-size: calc(12px * var(--text-scale)); font-weight: 760; text-overflow: ellipsis; white-space: nowrap; }
  .node-state { display: inline-flex; align-items: center; gap: 6px; color: var(--rondo-success, #2d9f75); font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .node-state i { width: 7px; height: 7px; background: currentColor; border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 15%, transparent); }
  .node-state.offline { color: var(--rondo-danger, #c75b68); }
  .rooms-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 10px; padding: 11px 8px 8px; color: var(--rondo-text-light, #7b8ca3); border-top: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 18%, transparent); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }
  .rooms-heading small, .members-panel > header strong { padding: 3px 7px; color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-bg, #e4e9f0); border-radius: 999px; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); font-size: calc(8px * var(--text-scale)); }
  .room-list { padding: 5px 10px 13px; overflow-y: auto; scrollbar-color: var(--rondo-bg-dark, #d1d9e6) transparent; }
  .room-list button { display: grid; grid-template-columns: 20px minmax(0, 1fr) 18px; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 10px; color: var(--rondo-text-muted, #5c6d84); background: transparent; border: 0; border-radius: 12px; cursor: pointer; font-size: calc(10px * var(--text-scale)); text-align: left; transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .room-list button:hover { color: var(--rondo-primary, #5b54e0); background: color-mix(in srgb, var(--rondo-bg-light, #edf1f7) 70%, transparent); transform: translateX(1px); }
  .room-list button.active { color: var(--rondo-primary, #5b54e0); background: linear-gradient(145deg, color-mix(in srgb, var(--rondo-bg-light, #edf1f7) 90%, white), var(--rondo-bg-dark, #d1d9e6)); box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); font-weight: 760; }
  .room-list button:focus-visible, .room-toolbar button:focus-visible { outline: 2px solid color-mix(in srgb, var(--rondo-primary, #5b54e0) 48%, transparent); outline-offset: 2px; }
  .room-list svg, .room-toolbar svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.45; }
  .room-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .voice-dot { width: 6px; height: 6px; background: var(--rondo-text-light, #7b8ca3); border-radius: 50%; opacity: .72; }
  .voice-count { display: grid; min-width: 17px; height: 17px; padding: 0 4px; color: #fff; background: linear-gradient(145deg, var(--rondo-success, #2d9f75), color-mix(in srgb, var(--rondo-success, #2d9f75) 75%, #174e3c)); border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-style: normal; place-items: center; }
  .space-identity { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; gap: 10px; margin: 10px; padding: 11px; background: var(--rondo-bg, #e4e9f0); border-radius: 15px; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); }
  .identity-avatar, .member-avatar { display: grid; position: relative; width: 34px; height: 34px; color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); font-size: calc(10px * var(--text-scale)); font-weight: 760; place-items: center; }
  .space-identity div, .member-row div { display: grid; gap: 3px; min-width: 0; }
  .space-identity strong, .member-row strong { overflow: hidden; color: var(--rondo-text, #2d3748); font-size: calc(9px * var(--text-scale)); font-weight: 740; text-overflow: ellipsis; white-space: nowrap; }
  .space-identity div span, .member-row div span { color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); }

  .room-content { display: grid; position: relative; grid-template-rows: 62px minmax(0, 1fr); }
  .room-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 20px; background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4)); border-bottom: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 18%, transparent); }
  .room-toolbar > div { display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--rondo-text-light, #7b8ca3); }
  .room-toolbar strong { overflow: hidden; color: var(--rondo-text, #2d3748); font-size: calc(12px * var(--text-scale)); font-weight: 760; text-overflow: ellipsis; white-space: nowrap; }
  .room-toolbar div span { padding-left: 10px; color: var(--rondo-text-light, #7b8ca3); border-left: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 28%, transparent); font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .room-toolbar button { display: inline-flex; align-items: center; gap: 7px; min-height: 35px; padding: 0 12px; color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 710; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .room-toolbar button:hover { color: var(--rondo-primary, #5b54e0); transform: translateY(-1px); }
  .room-toolbar button:active { box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); transform: none; }
  .toolbar-actions { display: flex; align-items: center; gap: 9px; }
  .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 4px; background: var(--rondo-bg-dark, #d1d9e6); border: 0; border-radius: 13px; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); }
  .room-toolbar .mode-switch button { min-height: 27px; padding: 0 10px; background: transparent; border: 0; border-radius: 9px; box-shadow: none; }
  .room-toolbar .mode-switch button.active { color: var(--rondo-primary, #5b54e0); background: var(--rondo-surface-strong, #eef2f8); box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); }
  .room-toolbar .join-voice { color: #fff; background: linear-gradient(145deg, var(--rondo-success, #2d9f75), color-mix(in srgb, var(--rondo-success, #2d9f75) 75%, #174e3c)); box-shadow: 5px 6px 13px color-mix(in srgb, var(--rondo-success, #2d9f75) 25%, transparent); }
  .room-toolbar .join-voice:hover { color: #fff; }
  .room-toolbar .join-voice:disabled { opacity: .62; cursor: progress; }
  .room-toolbar .settings-button { max-width: 170px; }

  .members-panel { padding: 0 10px 18px; overflow-y: auto; scrollbar-color: var(--rondo-bg-dark, #d1d9e6) transparent; }
  .members-panel > header { display: flex; align-items: center; justify-content: space-between; height: 62px; padding: 0 8px; border-bottom: 1px solid color-mix(in srgb, var(--rondo-text-light, #7b8ca3) 18%, transparent); }
  .members-panel > header span { color: var(--rondo-primary, #5b54e0); font-size: calc(10px * var(--text-scale)); font-weight: 760; }
  .members-panel section { margin-top: 17px; }
  .members-panel h3 { margin: 0 8px 8px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .09em; text-transform: uppercase; }
  .member-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 48px; padding: 6px 8px; border-radius: 13px; transition: background 140ms ease, transform 140ms ease; }
  .member-row:hover { background: color-mix(in srgb, var(--rondo-bg-light, #edf1f7) 75%, transparent); transform: translateX(1px); }
  .member-avatar i { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; background: var(--rondo-success, #2d9f75); border: 2px solid var(--rondo-surface, #e8edf4); border-radius: 50%; }
  .offline-member { opacity: .5; }
  .no-members { margin: 12px 8px; color: var(--rondo-text-light, #7b8ca3); font-size: calc(9px * var(--text-scale)); }

  @media (max-width: 1120px) {
    .space-shell { grid-template-columns: minmax(196px, 218px) minmax(0, 1fr); padding-right: 10px; }
    .members-panel { display: none; }
  }
  @media (max-width: 720px) {
    .space-shell { grid-template-columns: minmax(168px, 196px) minmax(0, 1fr); gap: 8px; padding: 8px 8px 8px 4px; }
    .room-toolbar { gap: 8px; padding: 0 12px; }
    .room-toolbar div span { display: none; }
    .room-toolbar .settings-button { max-width: 42px; padding: 0 11px; font-size: 0; }
    .room-toolbar .settings-button svg { flex: 0 0 auto; }
  }
</style>
