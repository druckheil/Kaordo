<script lang="ts">
  import { onMount } from 'svelte';
  import type { FluoMedia } from '@kaordo/contracts';
  import type { MediaPlayerElement } from 'vidstack/elements';
  import type { VideoMimeType, VideoSrc } from 'vidstack';

  let { media }: { media: FluoMedia } = $props();
  let player = $state<MediaPlayerElement>();
  let registered = $state(false);

  const source = $derived<VideoSrc>({
    src: media.url,
    type: normalizeMimeType(media.mimeType)
  });

  onMount(() => {
    let active = true;
    void Promise.all([
      import('vidstack/player'),
      import('vidstack/player/layouts/default'),
      import('vidstack/player/ui'),
      import('vidstack/player/styles/default/theme.css'),
      import('vidstack/player/styles/default/layouts/video.css')
    ]).then(() => {
      if (active) registered = true;
    });

    return () => {
      active = false;
      const video = player?.querySelector('video');
      if (!video) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  });

  function normalizeMimeType(value: string): VideoMimeType {
    const type = value.split(';', 1)[0]?.trim().toLowerCase();
    if (type === 'video/webm') return 'video/webm';
    if (type === 'video/3gp') return 'video/3gp';
    if (type === 'video/ogg') return 'video/ogg';
    if (type === 'video/avi' || type === 'video/x-msvideo') return 'video/avi';
    if (type === 'video/mpeg') return 'video/mpeg';
    // Vidstack's provider union has no QuickTime entry. The native decoder can
    // still play the source; MP4 is used only as the provider selection hint.
    return 'video/mp4';
  }
</script>

<div class="h-full w-full overflow-hidden rounded-xl bg-black" style:aspect-ratio={`${media.width}/${media.height}`}>
  {#if registered}
    <media-player
      bind:this={player}
      class="fluo-video-player"
      title={media.altText || 'Video attachment'}
      aria-label={media.altText || 'Video attachment'}
      src={source}
      viewType="video"
      playsinline
      preload="metadata"
      data-testid="fluo-video-player"
    >
      <media-provider></media-provider>
      <media-video-layout></media-video-layout>
    </media-player>
  {:else}
    <div class="h-full w-full bg-black" aria-label="Loading video preview" role="status"></div>
  {/if}
</div>

<style>
  .fluo-video-player {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
    --media-brand: #4b8b76;
    --media-focus-color: #5fae91;
    --media-font-family: inherit;
    --media-font-size: 12px;
    --media-radius: 0;
  }
</style>
