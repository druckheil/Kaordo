<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { LigoAttachment } from '../../lib/domain/ligo';
  import { createLigoPlaybackSource } from '../../lib/services/LigoPlaybackSource';

  type Props = { attachment: LigoAttachment };
  let { attachment }: Props = $props();
  let inlineVideo = $state<HTMLVideoElement>();
  let fullscreenVideo = $state<HTMLVideoElement>();
  let source = $state('');
  let fullscreen = $state(false);
  let loading = $state(true);
  let mediaError = $state(false);
  let customFullscreen = $state(false);
  let resumeAt = 0;
  let resumePlaying = false;
  let previousOverflow: string | null = null;

  $effect(() => {
    let disposed = false;
    let releaseSource = () => {};
    source = '';
    loading = true;
    mediaError = false;
    customFullscreen = false;
    // The desktop build plays from Tauri's native cache. Its asset protocol
    // supports byte ranges reliably, unlike a Blob restored from IndexedDB.
    void createLigoPlaybackSource(attachment).then((playback) => {
      if (disposed) {
        playback.release();
        return;
      }
      releaseSource = playback.release;
      customFullscreen = playback.customFullscreen;
      source = playback.url;
    }).catch(() => {
      if (!disposed) {
        loading = false;
        mediaError = true;
      }
    });
    return () => {
      disposed = true;
      releaseSource();
    };
  });
  onDestroy(() => {
    if (previousOverflow !== null) document.documentElement.style.overflow = previousOverflow;
  });

  async function openFullscreen(): Promise<void> {
    if (!source || mediaError) return;
    resumeAt = inlineVideo?.currentTime ?? 0;
    resumePlaying = Boolean(inlineVideo && !inlineVideo.paused && !inlineVideo.ended);
    inlineVideo?.pause();
    if (previousOverflow === null) previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    fullscreen = true;
    await tick();
    if (!fullscreenVideo) return;
    fullscreenVideo.currentTime = resumeAt;
    if (resumePlaying) await fullscreenVideo.play().catch(() => undefined);
  }

  async function closeFullscreen(): Promise<void> {
    if (!fullscreen) return;
    resumeAt = fullscreenVideo?.currentTime ?? resumeAt;
    resumePlaying = Boolean(fullscreenVideo && !fullscreenVideo.paused && !fullscreenVideo.ended);
    fullscreenVideo?.pause();
    fullscreen = false;
    document.documentElement.style.overflow = previousOverflow ?? '';
    previousOverflow = null;
    await tick();
    if (!inlineVideo) return;
    inlineVideo.currentTime = resumeAt;
    if (resumePlaying) await inlineVideo.play().catch(() => undefined);
  }

  function keydown(event: KeyboardEvent): void {
    if (!fullscreen || event.key !== 'Escape') return;
    event.preventDefault();
    void closeFullscreen();
  }

  function ready(): void {
    loading = false;
    mediaError = false;
  }

  function failed(): void {
    loading = false;
    mediaError = true;
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="player" class:failed={mediaError} class:loading>
  {#if source}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={inlineVideo} src={source} controls preload="metadata"
      playsinline aria-label={attachment.name} onloadedmetadata={ready} onerror={failed}></video>
  {/if}
  {#if loading}
    <div class="preparing" aria-live="polite"><i></i><span>Preparing video…</span></div>
  {:else if mediaError}
    <div class="unsupported" role="alert">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 18 17H2z"/><path d="M10 7v5M10 14.5v.1"/></svg>
      <span><strong>Video format is not supported</strong><small>{attachment.name}</small></span>
    </div>
  {:else if source && customFullscreen}
    <button class="expand" type="button" onclick={openFullscreen} title="Open video fullscreen"
      aria-label={`Open ${attachment.name} fullscreen`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4"/></svg>
    </button>
  {/if}
</div>

{#if fullscreen}
  <div class="fullscreen" role="dialog" aria-modal="true" aria-label={`Fullscreen ${attachment.name}`}>
    <button class="backdrop" type="button" onclick={closeFullscreen} aria-label="Close fullscreen video"></button>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={fullscreenVideo} src={source} controls preload="auto"
      playsinline aria-label={attachment.name} onloadedmetadata={ready} onerror={failed}></video>
    <button class="close" type="button" onclick={closeFullscreen} title="Close (Esc)" aria-label="Close fullscreen video">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>
    </button>
  </div>
{/if}

<style>
  .player{position:relative;width:100%;max-width:100%;aspect-ratio:16/9;overflow:hidden;background:#050706;border-radius:8px;contain:layout paint}.player>video{display:block;width:100%;height:100%;margin:0;background:#050706;object-fit:contain}.preparing,.unsupported{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:11px;padding:18px;color:rgb(255 255 255 / 70%);text-align:left;background:linear-gradient(145deg,#111714,#080b0a)}.preparing{font-size:calc(10px * var(--text-scale))}.preparing i{width:17px;height:17px;border:2px solid rgb(255 255 255 / 17%);border-top-color:rgb(255 255 255 / 68%);border-radius:50%;animation:spin 700ms linear infinite}.expand,.close{position:absolute;z-index:2;display:grid;width:36px;height:36px;padding:0;color:white;background:rgb(5 10 8 / 66%);border:1px solid rgb(255 255 255 / 19%);border-radius:10px;cursor:pointer;place-items:center;backdrop-filter:blur(8px);transition:background 130ms ease,transform 130ms ease}.expand{top:9px;right:9px}.expand:hover,.close:hover{background:rgb(5 10 8 / 84%);transform:scale(1.04)}.expand:focus-visible,.close:focus-visible{outline:2px solid white;outline-offset:2px}.expand svg,.close svg{width:19px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.6}.unsupported svg{flex:none;width:28px;fill:none;stroke:#dba35e;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.4}.unsupported span{display:grid;min-width:0;gap:4px}.unsupported strong{font-size:calc(11px * var(--text-scale))}.unsupported small{overflow:hidden;color:rgb(255 255 255 / 48%);font-size:calc(9px * var(--text-scale));text-overflow:ellipsis;white-space:nowrap}.fullscreen{position:fixed;z-index:410;inset:0;display:grid;padding:56px 68px 66px;place-items:center;isolation:isolate;animation:fullscreen-enter 170ms ease-out both}.backdrop{position:absolute;z-index:-1;inset:0;width:100%;height:100%;padding:0;background:rgb(2 4 3 / 96%);border:0;cursor:default;backdrop-filter:blur(14px)}.fullscreen>video{display:block;width:100%;height:100%;max-width:100%;max-height:100%;margin:0;background:#000;object-fit:contain}.close{top:18px;right:20px}.close svg{width:20px}@keyframes fullscreen-enter{from{opacity:0;transform:scale(.985)}}@keyframes spin{to{transform:rotate(1turn)}}@media(max-width:700px){.fullscreen{padding:50px 10px 58px}.close{top:10px;right:10px}}
</style>
