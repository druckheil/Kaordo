<script lang="ts">
  import { onDestroy } from 'svelte';

  type Props = {
    compact?: boolean;
    name: string;
    onError?: () => void;
    src: string;
  };

  const VOLUME_STORAGE_KEY = 'kaordo.fluo.audio-volume';

  let {
    compact = false,
    name,
    onError,
    src,
  }: Props = $props();
  let audio = $state<HTMLAudioElement>();
  let currentTime = $state(0);
  let duration = $state(0);
  let playing = $state(false);
  let volume = $state(readStoredVolume());
  let loadedSource = '';

  $effect(() => {
    const element = audio;
    if (element) element.volume = volume;
  });

  // Keep the media element stable while the parent feed re-renders. A source
  // change is the only event that should reset playback state.
  $effect(() => {
    const element = audio;
    const nextSource = src;
    if (!element || !nextSource || loadedSource === nextSource) return;
    const sourceChanged = Boolean(loadedSource);
    loadedSource = nextSource;
    if (!sourceChanged) return;
    if (!element.paused) element.pause();
    playing = false;
    currentTime = 0;
    duration = 0;
    element.src = nextSource;
    element.load();
  });

  onDestroy(() => {
    if (audio && !audio.paused) audio.pause();
    persistVolume();
  });

  async function togglePlayback(): Promise<void> {
    const element = audio;
    if (!element) return;
    if (element.paused) {
      try {
        await element.play();
      } catch {
        onError?.();
      }
    } else {
      element.pause();
    }
  }

  function skip(seconds: number): void {
    const element = audio;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = clamp(element.currentTime + seconds, 0, element.duration);
  }

  function seek(event: Event): void {
    const element = audio;
    if (!element || duration <= 0) return;
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) element.currentTime = clamp(value, 0, duration);
  }

  function updateVolume(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    volume = clamp(value, 0, 1);
  }

  function persistVolume(): void {
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // Storage can be unavailable in private/webview contexts; playback is
      // still fully usable for the current session.
    }
  }

  function handleLoadedMetadata(): void {
    const value = audio?.duration ?? 0;
    duration = Number.isFinite(value) && value > 0 ? value : 0;
  }

  function handleTimeUpdate(): void {
    currentTime = audio?.currentTime ?? 0;
  }

  function handlePlay(): void {
    playing = true;
  }

  function handlePause(): void {
    playing = false;
  }

  function handleEnded(): void {
    playing = false;
    currentTime = duration;
  }

  function readStoredVolume(): number {
    try {
      const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (raw === null) return 1;
      const stored = Number(raw);
      return Number.isFinite(stored) ? clamp(stored, 0, 1) : 1;
    } catch {
      return 1;
    }
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function formatTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '00:00';
    const totalSeconds = Math.floor(value);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
</script>

<div class="audio-player" class:audio-player--compact={compact} aria-label={`Audio ${name}`}>
  <div class="audio-player__heading">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z" /></svg>
    <span title={name}>{name}</span>
    <label class="audio-player__volume" title="Volume">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Zm12-1.5a4 4 0 0 1 0 7m2.5-9.5a7.5 7.5 0 0 1 0 12" /></svg>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        aria-label="Volume"
        onchange={persistVolume}
        oninput={updateVolume}
      />
    </label>
  </div>

  <audio
    bind:this={audio}
    src={src}
    preload="metadata"
    aria-label={name}
    onloadedmetadata={handleLoadedMetadata}
    ontimeupdate={handleTimeUpdate}
    onplay={handlePlay}
    onpause={handlePause}
    onended={handleEnded}
    onerror={() => onError?.()}
  ></audio>

  <div class="audio-player__controls">
    <button type="button" aria-label="Rewind 15 seconds" title="Rewind 15 seconds" onclick={() => skip(-15)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5A7 7 0 1 1 5.1 16" />
        <path d="m8 2.5-4.2 4.2L8 10.9" />
        <text x="12" y="14.2" text-anchor="middle" fill="currentColor" stroke="none">15</text>
      </svg>
    </button>
    <button type="button" class="audio-player__play" aria-label={playing ? 'Pause audio' : 'Play audio'} title={playing ? 'Pause' : 'Play'} onclick={togglePlayback}>
      {#if playing}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" /></svg>
      {/if}
    </button>
    <button type="button" aria-label="Forward 15 seconds" title="Forward 15 seconds" onclick={() => skip(15)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 5.5A7 7 0 1 0 18.9 16" />
        <path d="m16 2.5 4.2 4.2-4.2 4.2" />
        <text x="12" y="14.2" text-anchor="middle" fill="currentColor" stroke="none">15</text>
      </svg>
    </button>
    <span class="audio-player__time">{formatTime(currentTime)}</span>
    <input
      class="audio-player__timeline"
      type="range"
      min="0"
      max={duration || 1}
      step="0.01"
      value={Math.min(currentTime, duration || 1)}
      aria-label="Playback position"
      oninput={seek}
    />
    <span class="audio-player__time audio-player__time--duration">{formatTime(duration)}</span>
  </div>
</div>

<style>
  .audio-player {
    display: grid;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    gap: 4px;
    padding: 7px 12px;
    overflow: hidden;
    color: var(--sui-text);
    background: var(--sui-bg-light);
  }

  .audio-player--compact {
    padding: 0;
    background: transparent;
    box-shadow: none;
  }

  .audio-player__heading {
    display: flex;
    min-width: 0;
    max-width: 100%;
    height: 18px;
    align-items: center;
    gap: 7px;
    color: var(--sui-primary);
    font-size: calc(10px * var(--text-scale));
    font-weight: 680;
    line-height: 1;
  }

  .audio-player__heading > svg {
    width: 18px;
    height: 18px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
  }

  .audio-player__heading > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-player__volume {
    display: flex;
    min-width: 0;
    margin-left: auto;
    align-items: center;
    gap: 5px;
    color: var(--sui-text-muted);
    cursor: pointer;
  }

  .audio-player__volume svg {
    width: 15px;
    height: 15px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .audio-player__volume input {
    width: 64px;
    min-width: 40px;
    height: 16px;
    margin: 0;
    accent-color: var(--sui-primary);
    cursor: pointer;
  }

  audio {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .audio-player__controls {
    display: grid;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: 29px;
    box-sizing: border-box;
    grid-template-columns: 28px 30px 28px minmax(36px, max-content) minmax(0, 1fr) minmax(36px, max-content);
    align-items: center;
    gap: 5px;
  }

  .audio-player__controls button {
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    color: var(--sui-text);
    background: var(--sui-bg-light);
    border: 0;
    border-radius: 50%;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 120ms ease, box-shadow 120ms ease, color 120ms ease;
  }

  .audio-player__controls button:hover {
    color: var(--sui-primary);
    transform: translateY(-1px);
  }

  .audio-player__controls button:active {
    transform: translateY(1px) scale(.94);
    box-shadow: var(--sui-shadow-inset-sm);
  }

  .audio-player__controls button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 60%, transparent);
    outline-offset: 2px;
  }

  .audio-player__controls button svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .audio-player__controls button svg text {
    font-family: inherit;
    font-size: 6px;
    font-weight: 750;
  }

  .audio-player__controls .audio-player__play {
    color: var(--sui-primary);
  }

  .audio-player__time {
    min-width: 0;
    color: var(--sui-text);
    font-size: calc(10px * var(--text-scale));
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: center;
    white-space: nowrap;
  }

  .audio-player__timeline {
    display: block;
    width: 100%;
    min-width: 0;
    height: 18px;
    margin: 0;
    accent-color: var(--sui-primary);
    cursor: pointer;
  }

  @media (max-width: 460px) {
    .audio-player { padding-inline: 7px; }
    .audio-player__volume input { width: 48px; }
    .audio-player__controls { grid-template-columns: 26px 28px 26px minmax(32px, max-content) minmax(0, 1fr) minmax(32px, max-content); gap: 3px; }
    .audio-player__controls button { width: 26px; height: 26px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .audio-player__controls button { transition: none; }
  }
</style>
