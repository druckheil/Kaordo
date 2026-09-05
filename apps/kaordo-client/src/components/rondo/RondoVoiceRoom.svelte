<script lang="ts">
  import type { RondoPresentationPreferences } from '../../lib/domain/mediaSettings';
  import type { RondoVoiceSnapshot } from '../../lib/services/RondoVoiceSession';

  type Props = {
    onLeave: () => Promise<void>;
    onToggleCamera: () => Promise<void>;
    onToggleDeafen: () => void;
    onToggleMute: () => void;
    onToggleScreen: () => Promise<void>;
    onPresentationChange: (preferences: RondoPresentationPreferences) => void | Promise<void>;
    roomName: string;
    voice: RondoVoiceSnapshot;
  };

  let {
    onLeave, onPresentationChange, onToggleCamera, onToggleDeafen, onToggleMute, onToggleScreen, roomName, voice,
  }: Props = $props();

  let showPresentationSettings = $state(false);

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

  function presentationLabel(stream: MediaStream): string {
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() as MediaTrackSettings & { displaySurface?: string } | undefined;
    return settings?.displaySurface ? 'Screen share' : 'Camera';
  }

  function updatePresentation(key: keyof RondoPresentationPreferences, value: number): void {
    void onPresentationChange({ ...voice.presentation, [key]: value });
  }

  async function openFullscreen(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const tile = button.closest('.video-tile');
    const target = tile?.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!target) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (target.requestFullscreen) {
        await target.requestFullscreen();
      } else {
        target.webkitEnterFullscreen?.();
      }
    } catch {
      // Fullscreen is optional and can be denied by the host window.
    }
  }
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
                <div class="video-tile">
                  <video autoplay muted playsinline use:attach={stream}></video>
                  <button class="fullscreen-button" type="button" aria-label={`Open ${presentationLabel(stream)} from ${participant.username} full screen`} title={`Open ${presentationLabel(stream)} full screen`} onclick={openFullscreen}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M7 17H3v-4m10 4h4v-4" /></svg>
                  </button>
                </div>
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

  {#if showPresentationSettings}
    <div class="presentation-panel" role="dialog" aria-label="Presentation settings">
      <div class="presentation-heading"><strong>Presentation</strong><span>Applied to screen sharing</span></div>
      <label><span>Frame rate</span><select value={voice.presentation.fps} onchange={(event) => updatePresentation('fps', Number(event.currentTarget.value))}><option value={15}>15 FPS</option><option value={24}>24 FPS</option><option value={30}>30 FPS</option><option value={60}>60 FPS</option><option value={120}>120 FPS</option></select></label>
      <label><span>Resolution</span><select value={voice.presentation.resolution} onchange={(event) => updatePresentation('resolution', Number(event.currentTarget.value))}><option value={720}>720p</option><option value={1080}>1080p</option><option value={1440}>1440p</option></select></label>
    </div>
  {/if}

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
    <button class:active={showPresentationSettings} aria-expanded={showPresentationSettings} aria-label="Presentation settings" onclick={() => showPresentationSettings = !showPresentationSettings} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v2m0 10v2M3 10h2m10 0h2M5 5l1.4 1.4m7.2 7.2L15 15m0-10-1.4 1.4m-7.2 7.2L5 15M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /></svg>
      <span>Display</span>
    </button>
    <button class="hangup" aria-label="Leave voice" onclick={onLeave} type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 13c3-3 11-3 14 0l-2 3-3-2v-2H8v2l-3 2-2-3Z" /></svg>
      <span>Leave</span>
    </button>
  </div>
</section>

<style>
  .voice-room { display: grid; position: relative; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; padding: 18px; overflow: hidden; background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--rondo-primary, #5b54e0) 10%, transparent), transparent 38%), transparent; }
  .participant-grid { display: grid; align-content: center; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 12px; min-height: 0; overflow-y: auto; scrollbar-color: var(--rondo-bg-dark, #d1d9e6) transparent; }
  .participant-grid.compact { grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); }
  .participant-card { display: grid; position: relative; min-height: 190px; overflow: hidden; background: #252b35; border: 2px solid transparent; border-radius: 18px; box-shadow: var(--rondo-shadow-raised); transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease; place-items: center; }
  .participant-card:hover { transform: translateY(-1px); }
  .participant-card.speaking { border-color: var(--rondo-primary, #5b54e0); box-shadow: 0 0 0 4px color-mix(in srgb, var(--rondo-primary, #5b54e0) 18%, transparent), var(--rondo-shadow-raised); }
  .videos { display: grid; position: absolute; inset: 0; grid-template-columns: 1fr; background: #1e232c; }
  .videos.multiple { grid-template-columns: repeat(2, 1fr); }
  .video-tile { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #1e232c; }
  video { width: 100%; height: 100%; min-width: 0; object-fit: contain; background: #1e232c; }
  video:fullscreen, .video-tile:fullscreen { background: #10131a; object-fit: contain; }
  .fullscreen-button { display: grid; position: absolute; right: 9px; top: 9px; z-index: 3; width: 31px; height: 31px; padding: 0; color: #f3f6ff; background: rgb(18 22 31 / 68%); border: 1px solid rgb(255 255 255 / 13%); border-radius: 10px; box-shadow: 0 5px 12px rgb(0 0 0 / 22%); cursor: pointer; opacity: 0; place-items: center; transition: opacity 140ms ease, transform 140ms ease, background 140ms ease; }
  .video-tile:hover .fullscreen-button, .fullscreen-button:focus-visible { opacity: 1; }
  .fullscreen-button:hover { background: rgb(91 84 224 / 88%); transform: translateY(-1px); }
  .fullscreen-button svg { width: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .voice-avatar { display: grid; width: 82px; height: 82px; color: #fff; background: linear-gradient(145deg, var(--rondo-primary, #5b54e0), var(--rondo-primary-hover, #4a44c4)); border: 0; border-radius: 26px; box-shadow: 6px 7px 16px rgb(0 0 0 / 28%), -4px -4px 11px rgb(255 255 255 / 12%); font-size: calc(25px * var(--text-scale)); font-weight: 740; place-items: center; }
  .participant-card footer { display: flex; position: absolute; right: 10px; bottom: 10px; left: 10px; z-index: 2; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; color: #f1f4fb; background: rgb(20 23 31 / 68%); border: 1px solid rgb(255 255 255 / 10%); border-radius: 11px; backdrop-filter: blur(10px); font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .participant-card footer small { color: #b7bfce; font-size: calc(7px * var(--text-scale)); text-transform: capitalize; }
  .joining { display: flex; align-items: center; flex-direction: column; justify-content: center; gap: 10px; color: var(--rondo-text-muted, #5c6d84); }
  .joining i { width: 24px; height: 24px; border: 3px solid color-mix(in srgb, var(--rondo-primary, #5b54e0) 25%, transparent); border-top-color: var(--rondo-primary, #5b54e0); border-radius: 50%; animation: spin 700ms linear infinite; }
  .joining span { font-size: calc(11px * var(--text-scale)); font-weight: 720; }
  .joining small { color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); }
  .call-controls { display: flex; align-items: center; justify-content: center; gap: 9px; padding-top: 16px; }
  .call-controls button { display: grid; grid-template-rows: 30px auto; align-items: center; justify-items: center; width: 62px; min-height: 58px; padding: 6px 3px; color: var(--rondo-text-muted, #5c6d84); background: var(--rondo-surface, #e8edf4); border: 0; border-radius: 14px; box-shadow: var(--rondo-shadow-raised-sm, 3px 4px 9px rgb(39 51 67 / 16%), -3px -3px 8px rgb(255 255 255 / 52%)); cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 700; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .call-controls button:hover { color: var(--rondo-primary, #5b54e0); transform: translateY(-1px); }
  .call-controls button:active, .call-controls button.active { color: var(--rondo-primary, #5b54e0); background: var(--rondo-bg-dark, #d1d9e6); box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%)); transform: none; }
  .call-controls button.active:first-child, .call-controls button.active:nth-child(2) { color: var(--rondo-danger, #c75b68); }
  .call-controls .hangup { color: #fff; background: linear-gradient(145deg, var(--rondo-danger, #c75b68), color-mix(in srgb, var(--rondo-danger, #c75b68) 78%, #842e3d)); box-shadow: 5px 6px 13px color-mix(in srgb, var(--rondo-danger, #c75b68) 25%, transparent); }
  .call-controls .hangup:hover { color: #fff; }
  .call-controls svg { width: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .presentation-panel { display: grid; position: absolute; right: 18px; bottom: 91px; z-index: 5; width: min(250px, calc(100% - 36px)); gap: 12px; padding: 15px; background: linear-gradient(145deg, var(--rondo-surface-strong, #eef2f8), var(--rondo-surface, #e8edf4)); border-radius: 16px; box-shadow: var(--rondo-shadow-raised, 6px 7px 16px rgb(39 51 67 / 20%), -5px -5px 13px rgb(255 255 255 / 56%)); }
  .presentation-heading { display: grid; gap: 3px; }
  .presentation-heading strong { color: var(--rondo-text, #2d3748); font-size: calc(10px * var(--text-scale)); font-weight: 760; }
  .presentation-heading span { color: var(--rondo-text-light, #7b8ca3); font-size: calc(8px * var(--text-scale)); }
  .presentation-panel label { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; color: var(--rondo-text-muted, #5c6d84); font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .presentation-panel select { min-width: 100px; height: 32px; padding: 0 9px; color: var(--rondo-text, #2d3748); background: var(--rondo-bg, #e4e9f0); border: 0; border-radius: 10px; outline: none; box-shadow: var(--rondo-shadow-inset-sm, inset 2px 2px 6px rgb(39 51 67 / 15%), inset -2px -2px 5px rgb(255 255 255 / 50%)); font: inherit; font-size: calc(8px * var(--text-scale)); }
  .presentation-panel select:focus { box-shadow: var(--rondo-shadow-inset-sm), 0 0 0 3px color-mix(in srgb, var(--rondo-primary, #5b54e0) 18%, transparent); }
  .voice-error { position: absolute; top: 24px; left: 50%; z-index: 3; max-width: 520px; padding: 9px 12px; color: var(--rondo-danger, #c75b68); background: color-mix(in srgb, var(--rondo-danger, #c75b68) 10%, var(--rondo-surface-strong, #eef2f8)); border: 0; border-radius: 12px; box-shadow: var(--rondo-shadow-raised-sm); font-size: calc(8px * var(--text-scale)); transform: translateX(-50%); }
  @media (max-width: 720px) { .voice-room { padding: 12px; } .call-controls { gap: 6px; } .call-controls button { width: 54px; } .presentation-panel { right: 12px; bottom: 82px; } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
