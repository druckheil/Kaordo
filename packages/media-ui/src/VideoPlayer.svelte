<script lang="ts">
  // Loads Vidstack on demand and releases media resources when unmounted
  import { onMount } from 'svelte';
  import type { MediaPlayerElement } from 'vidstack/elements';
  import type { VideoMimeType, VideoSrc } from 'vidstack';
  import type { MediaAttachment } from './media-layout';

  interface Props {
    media: MediaAttachment;
    compact?: boolean;
  }

  const videoMimeTypeHints: Record<string, VideoMimeType> = {
    'video/webm': 'video/webm',
    'video/3gp': 'video/3gp',
    'video/ogg': 'video/ogg',
    'video/avi': 'video/avi',
    'video/x-msvideo': 'video/avi',
    'video/mpeg': 'video/mpeg'
  };

  let { media, compact = false }: Props = $props();
  let player = $state<MediaPlayerElement>();
  let registered = $state(false);

  const source = $derived<VideoSrc>({
    src: media.url,
    type: normalizeMimeType(media.mimeType)
  });

  onMount(() => {
    let active = true;

    void loadVidstack().then(() => {
      if (active) registered = true;
    });

    return () => {
      active = false;
      releaseVideo(player);
    };
  });

  function normalizeMimeType(value: string): VideoMimeType {
    const mimeType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    // MP4 is a provider selection hint for formats without a Vidstack provider entry
    return videoMimeTypeHints[mimeType] ?? 'video/mp4';
  }

  function loadVidstack(): Promise<unknown[]> {
    return Promise.all([
      import('vidstack/player'),
      import('vidstack/player/layouts/default'),
      import('vidstack/player/ui'),
      import('vidstack/player/styles/default/theme.css'),
      import('vidstack/player/styles/default/layouts/video.css')
    ]);
  }

  function releaseVideo(element: MediaPlayerElement | undefined): void {
    const video = element?.querySelector('video');
    if (!video) return;

    video.pause();
    video.removeAttribute('src');
    video.load();
  }
</script>

<div
  class="h-full w-full overflow-hidden bg-black"
  class:rounded-xl={!compact}
  style:aspect-ratio={`${media.width}/${media.height}`}
>
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
