<script lang="ts">
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
    onOpenSettings, onReturnLatest, onRoomMode, onSelectRoom, onSendMessage,
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
  .space-shell { display: grid; grid-template-columns: 218px minmax(0, 1fr) 226px; min-width: 0; min-height: 0; color: #354139; background: var(--canvas); }
  .rooms-panel, .members-panel { min-width: 0; min-height: 0; background: #f1f4f0; }
  .rooms-panel { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; border-right: 1px solid #d9dfda; }
  .rooms-panel > header { display: flex; align-items: center; justify-content: space-between; min-height: 66px; padding: 12px 14px; border-bottom: 1px solid #dce2dd; }
  .rooms-panel header div { display: grid; gap: 3px; min-width: 0; }
  .rooms-panel header div span { color: #8b968f; font-size: calc(8px * var(--text-scale)); font-weight: 720; letter-spacing: .11em; text-transform: uppercase; }
  .rooms-panel header strong { overflow: hidden; color: #334039; font-size: calc(12px * var(--text-scale)); font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
  .node-state { display: inline-flex; align-items: center; gap: 5px; color: #568572; font-size: calc(8px * var(--text-scale)); font-weight: 650; }
  .node-state i { width: 6px; height: 6px; background: #55a17f; border-radius: 50%; box-shadow: 0 0 0 3px rgb(85 161 127 / 10%); }
  .node-state.offline { color: #a7635a; }
  .node-state.offline i { background: #b96a5f; box-shadow: none; }
  .rooms-heading { display: flex; align-items: center; justify-content: space-between; padding: 17px 15px 7px; color: #78837c; font-size: calc(9px * var(--text-scale)); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
  .rooms-heading small { padding: 2px 6px; background: #e4e9e5; border-radius: 999px; font-size: calc(8px * var(--text-scale)); }
  .room-list { padding: 2px 8px 12px; overflow-y: auto; }
  .room-list button { display: grid; grid-template-columns: 20px minmax(0, 1fr) 18px; align-items: center; gap: 7px; width: 100%; height: 36px; padding: 0 9px; color: #68736c; background: transparent; border: 0; border-radius: 8px; cursor: pointer; font-size: calc(10px * var(--text-scale)); text-align: left; transition: color 120ms ease, background 120ms ease; }
  .room-list button:hover { color: #35433b; background: rgb(255 255 255 / 62%); }
  .room-list button.active { color: #315e50; background: #dfece6; font-weight: 680; }
  .room-list svg, .room-toolbar svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.45; }
  .room-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .voice-dot { width: 5px; height: 5px; background: #9db4aa; border-radius: 50%; opacity: .7; }
  .voice-count { display: grid; min-width: 16px; height: 16px; padding: 0 4px; color: #f2f8f5; background: #57907c; border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-style: normal; place-items: center; }
  .space-identity { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 9px; padding: 10px 13px; background: #e8ece8; border-top: 1px solid #d7ddd8; }
  .identity-avatar, .member-avatar { display: grid; position: relative; width: 32px; height: 32px; color: #edf7f2; background: linear-gradient(145deg, #578b79, #356757); border-radius: 10px; font-size: calc(10px * var(--text-scale)); font-weight: 750; place-items: center; }
  .space-identity div, .member-row div { display: grid; gap: 2px; min-width: 0; }
  .space-identity strong, .member-row strong { overflow: hidden; color: #425047; font-size: calc(9px * var(--text-scale)); font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
  .space-identity div span, .member-row div span { color: #89938d; font-size: calc(8px * var(--text-scale)); }

  .room-content { display: grid; position: relative; grid-template-rows: 54px minmax(0, 1fr); min-width: 0; min-height: 0; background: var(--canvas); }
  .room-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 17px; background: rgb(255 255 255 / 72%); border-bottom: 1px solid #dce2dd; box-shadow: 0 2px 8px rgb(39 59 50 / 4%); }
  .room-toolbar > div { display: flex; align-items: center; gap: 8px; min-width: 0; color: #6c7870; }
  .room-toolbar strong { color: #35423b; font-size: calc(11px * var(--text-scale)); font-weight: 700; }
  .room-toolbar div span { padding-left: 9px; color: #9aa39d; border-left: 1px solid #d9dfda; font-size: calc(8px * var(--text-scale)); font-weight: 640; }
  .room-toolbar button { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 10px; color: #5e6c64; background: #f5f8f5; border: 1px solid #d5dcd7; border-radius: 9px; cursor: pointer; font-size: calc(9px * var(--text-scale)); font-weight: 660; }
  .room-toolbar button:hover { color: var(--accent); border-color: #9ebbad; }
  .toolbar-actions { display: flex; align-items: center; gap: 7px; }
  .mode-switch { display: grid; grid-template-columns: 1fr 1fr; padding: 2px; background: #edf1ee; border: 1px solid #d7ddd9; border-radius: 9px; }
  .room-toolbar .mode-switch button { height: 26px; padding: 0 9px; background: transparent; border: 0; border-radius: 6px; box-shadow: none; }
  .room-toolbar .mode-switch button.active { color: #316a57; background: #fff; box-shadow: 0 2px 7px rgb(40 59 50 / 8%); }
  .room-toolbar .join-voice { color: #356f5c; background: #e8f1ed; border-color: #c4d8cf; }
  .room-toolbar .join-voice:disabled { opacity: .62; cursor: progress; }
  .room-toolbar .settings-button { max-width: 150px; }
  .members-panel { padding: 0 10px 20px; overflow-y: auto; border-left: 1px solid #d9dfda; }
  .members-panel > header { display: flex; align-items: center; justify-content: space-between; height: 54px; padding: 0 7px; border-bottom: 1px solid #dce2dd; }
  .members-panel > header span { color: #5d6962; font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .members-panel > header strong { padding: 3px 7px; color: #758078; background: #e3e8e4; border-radius: 999px; font-size: calc(8px * var(--text-scale)); }
  .members-panel section { margin-top: 17px; }
  .members-panel h3 { margin: 0 7px 8px; color: #87918b; font-size: calc(8px * var(--text-scale)); font-weight: 740; letter-spacing: .08em; text-transform: uppercase; }
  .member-row { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 9px; min-height: 43px; padding: 5px 7px; border-radius: 9px; }
  .member-row:hover { background: rgb(255 255 255 / 55%); }
  .member-avatar i { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; background: #57a27f; border: 2px solid #f1f4f0; border-radius: 50%; }
  .offline-member { opacity: .52; }
  .no-members { margin: 12px 7px; color: #9aa39d; font-size: calc(9px * var(--text-scale)); }

  @media (max-width: 1120px) { .space-shell { grid-template-columns: 200px minmax(0, 1fr); } .members-panel { display: none; } }
</style>
