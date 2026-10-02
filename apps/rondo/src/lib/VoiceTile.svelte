<script lang="ts">
  import { onMount } from 'svelte';
  import type { VoiceConnection, VoiceVideo } from '@kaordo/voice-client';
  import { Button, Maximize2Icon, Minimize2Icon, MonitorUpIcon, VideoIcon } from '@kaordo/ui';

  let { connection, video, large = false }: {
    connection: VoiceConnection;
    video: VoiceVideo;
    large?: boolean;
  } = $props();
  let frame: HTMLDivElement;
  let element: HTMLVideoElement;
  let isFullscreen = $state(false);
  let fullscreenError = $state('');
  let fullscreenRevision = 0;

  onMount(() => {
    const detach = connection.attachVideo(video, element);
    const syncFullscreen = () => {
      fullscreenRevision++;
      isFullscreen = document.fullscreenElement === frame;
      if (isFullscreen) fullscreenError = '';
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      detach();
    };
  });

  async function toggleFullscreen() {
    fullscreenError = '';
    const revision = fullscreenRevision;
    try {
      if (document.fullscreenElement === frame) await document.exitFullscreen();
      else await frame.requestFullscreen();
    } catch {
      if (fullscreenRevision === revision && document.fullscreenElement !== frame) fullscreenError = 'Fullscreen unavailable.';
    }
  }
</script>

<div bind:this={frame} data-voice-video-id={video.id}
  class={`voice-tile group relative min-w-0 overflow-hidden rounded-xl border border-border/50 bg-[#101916] shadow-sm ${large ? 'h-full w-full' : 'w-[min(9rem,48%)] sm:w-40'}`}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={element} autoplay playsinline muted={video.local}
    class={`block object-contain ${large ? 'h-full w-full' : 'aspect-video w-full'} ${video.local && video.source === 'camera' ? '-scale-x-100' : ''}`}
    aria-label={`${video.local ? 'Your' : video.name + '’s'} ${video.source === 'camera' ? 'camera' : 'screen'}`}>
  </video>
  <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 pt-7 text-white">
    <span class="inline-flex min-w-0 items-center gap-1 truncate text-[11px] font-semibold">
      {#if video.source === 'screen'}<MonitorUpIcon class="size-3.5 shrink-0" />{:else}<VideoIcon class="size-3.5 shrink-0" />{/if}
      <span class="truncate">{video.local ? 'You' : video.name} · {video.source === 'screen' ? 'Screen' : 'Camera'}</span>
    </span>
  </div>
  {#if !large || isFullscreen}
    <Button variant="secondary" size="icon-xs" class="absolute right-1.5 top-1.5 z-10 opacity-85 group-hover:opacity-100 focus-visible:opacity-100"
      aria-label={`${isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} ${video.local ? 'your' : video.name + '’s'} ${video.source}`}
      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen video'} onclick={() => void toggleFullscreen()}>
      {#if isFullscreen}<Minimize2Icon class="size-3.5" />{:else}<Maximize2Icon class="size-3.5" />{/if}
    </Button>
  {/if}
  {#if fullscreenError}<p class="absolute bottom-9 left-2 right-2 z-10 rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground" role="alert">{fullscreenError}</p>{/if}
</div>

<style>
  .voice-tile:fullscreen {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw !important;
    height: 100dvh !important;
    border: 0;
    border-radius: 0;
  }
  .voice-tile:fullscreen video {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    object-fit: contain;
  }
</style>
