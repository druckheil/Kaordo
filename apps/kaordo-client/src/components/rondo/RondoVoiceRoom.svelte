<script lang="ts">
  import type { RondoVoiceSnapshot } from '../../lib/services/RondoVoiceSession';

  type Props = {
    onLeave: () => Promise<void>;
    onToggleCamera: () => Promise<void>;
    onToggleDeafen: () => void;
    onToggleMute: () => void;
    onToggleScreen: () => Promise<void>;
    roomName: string;
    voice: RondoVoiceSnapshot;
  };

  let {
    onLeave, onToggleCamera, onToggleDeafen, onToggleMute, onToggleScreen, roomName, voice,
  }: Props = $props();

  function attach(node: HTMLMediaElement, stream: MediaStream) {
    node.srcObject = stream;
    void node.play().catch(() => undefined);
    return {
      update(next: MediaStream) {
        node.srcObject = next;
        void node.play().catch(() => undefined);
      },
      destroy() { node.srcObject = null; },
    };
  }

  function videoStreams(streams: MediaStream[]): MediaStream[] {
    return streams.filter((stream) => stream.getVideoTracks().some(({ readyState }) => readyState === 'live'));
  }

  function initial(username: string): string { return username[0]?.toUpperCase() ?? '?'; }
</script>

<section class="voice-room" aria-label={`#${roomName} voice call`}>
  {#if voice.phase === 'joining'}
    <div class="joining"><i></i><span>Connecting to voice…</span><small>Requesting microphone access</small></div>
  {:else}
    <div class:compact={voice.participants.length > 6} class="participant-grid">
      {#each voice.participants as participant (participant.peerId)}
        <article class:speaking={participant.speaking} class="participant-card">
          {#if videoStreams(participant.streams).length}
            <div class:multiple={videoStreams(participant.streams).length > 1} class="videos">
              {#each videoStreams(participant.streams) as stream (stream.id)}
                <video autoplay muted playsinline use:attach={stream}></video>
              {/each}
            </div>
          {:else}
            <div class="voice-avatar">{initial(participant.username)}</div>
          {/if}
          <footer>
            <span>{participant.username}{participant.local ? ' (You)' : ''}</span>
            {#if participant.connection !== 'connected' && !participant.local}
              <small>{participant.connection === 'new' ? 'Connecting' : participant.connection}</small>
            {/if}
          </footer>
        </article>
      {/each}
    </div>
  {/if}

  {#if voice.error}<div class="voice-error" role="alert">{voice.error}</div>{/if}

  <div class="call-controls" aria-label="Voice controls">
    <button class:active={voice.muted} aria-label={voice.muted ? 'Unmute' : 'Mute'} onclick={onToggleMute} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6v4a3 3 0 0 0 5.2 2M13 9V6a3 3 0 0 0-5.5-1.7M5 9v1a5 5 0 0 0 8.8 3.2M10 15v2m-3 0h6M3 3l14 14" /></svg>
      <span>{voice.muted ? 'Unmute' : 'Mute'}</span>
    </button>
    <button class:active={voice.deafened} aria-label={voice.deafened ? 'Undeafen' : 'Deafen'} onclick={onToggleDeafen} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 11V9a6 6 0 0 1 12 0v2M4 11H3v4h3v-4H4Zm12 0h1v4h-3v-4h2ZM3 3l14 14" /></svg>
      <span>{voice.deafened ? 'Undeafen' : 'Deafen'}</span>
    </button>
    <button class:active={voice.cameraOn} aria-label={voice.cameraOn ? 'Stop camera' : 'Start camera'} onclick={onToggleCamera} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h9v8H3V6Zm9 2.5 5-2v7l-5-2" /></svg>
      <span>Camera</span>
    </button>
    <button class:active={voice.screenOn} aria-label={voice.screenOn ? 'Stop sharing' : 'Share screen'} onclick={onToggleScreen} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v10H3V4Zm4 13h6m-3-3v3M7 9l3-3 3 3m-3-3v6" /></svg>
      <span>Share</span>
    </button>
    <button class="hangup" aria-label="Leave voice" onclick={onLeave} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 13c3-3 11-3 14 0l-2 3-3-2v-2H8v2l-3 2-2-3Z" /></svg>
      <span>Leave</span>
    </button>
  </div>
</section>

<style>
  .voice-room { display: grid; position: relative; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; padding: 16px; overflow: hidden; background: radial-gradient(circle at 50% 38%, rgb(70 128 108 / 8%), transparent 34%), #edf1ed; }
  .participant-grid { display: grid; align-content: center; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; min-height: 0; overflow-y: auto; }
  .participant-grid.compact { grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); }
  .participant-card { display: grid; position: relative; min-height: 190px; overflow: hidden; background: #26312b; border: 2px solid transparent; border-radius: 15px; box-shadow: 0 10px 28px rgb(35 53 44 / 9%); transition: border-color 100ms, box-shadow 100ms; place-items: center; }
  .participant-card.speaking { border-color: #65b18e; box-shadow: 0 0 0 3px rgb(76 166 126 / 13%), 0 10px 28px rgb(35 53 44 / 10%); }
  .videos { display: grid; position: absolute; inset: 0; grid-template-columns: 1fr; background: #1e2823; }
  .videos.multiple { grid-template-columns: repeat(2, 1fr); }
  video { width: 100%; height: 100%; min-width: 0; object-fit: contain; }
  .voice-avatar { display: grid; width: 76px; height: 76px; color: #e9f4ef; background: linear-gradient(145deg, #689986, #3a6d5b); border: 1px solid rgb(255 255 255 / 18%); border-radius: 24px; box-shadow: 0 12px 30px rgb(13 28 21 / 22%); font-size: calc(23px * var(--text-scale)); font-weight: 730; place-items: center; }
  .participant-card footer { display: flex; position: absolute; right: 9px; bottom: 9px; left: 9px; z-index: 2; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; color: #f1f6f3; background: rgb(20 29 24 / 65%); border: 1px solid rgb(255 255 255 / 8%); border-radius: 8px; backdrop-filter: blur(10px); font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .participant-card footer small { color: #b5c2bb; font-size: calc(7px * var(--text-scale)); text-transform: capitalize; }
  .joining { display: flex; align-items: center; flex-direction: column; justify-content: center; gap: 9px; color: #4f6157; }
  .joining i { width: 22px; height: 22px; border: 3px solid #bdd0c7; border-top-color: #407a66; border-radius: 50%; animation: spin 700ms linear infinite; }
  .joining span { font-size: calc(11px * var(--text-scale)); font-weight: 680; }
  .joining small { color: #8c9891; font-size: calc(8px * var(--text-scale)); }
  .call-controls { display: flex; align-items: center; justify-content: center; gap: 7px; padding-top: 14px; }
  .call-controls button { display: grid; grid-template-rows: 30px auto; align-items: center; justify-items: center; width: 58px; min-height: 55px; padding: 5px 3px; color: #647169; background: rgb(255 255 255 / 75%); border: 1px solid #d2dbd5; border-radius: 11px; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 650; }
  .call-controls button:hover, .call-controls button.active { color: #2f6f5a; background: #e1eee8; border-color: #a9c7ba; }
  .call-controls button.active:first-child, .call-controls button.active:nth-child(2) { color: #9c4f46; background: #f7e8e6; border-color: #e3bcb7; }
  .call-controls .hangup { color: #fff; background: #af5148; border-color: #9d453d; }
  .call-controls .hangup:hover { color: #fff; background: #9e453d; border-color: #8e3933; }
  .call-controls svg { width: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .voice-error { position: absolute; top: 24px; left: 50%; z-index: 3; max-width: 520px; padding: 8px 11px; color: #985047; background: rgb(255 242 240 / 94%); border: 1px solid #e6c2bd; border-radius: 9px; box-shadow: 0 8px 20px rgb(73 39 35 / 10%); font-size: calc(8px * var(--text-scale)); transform: translateX(-50%); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
