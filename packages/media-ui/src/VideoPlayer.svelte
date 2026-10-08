<script lang="ts">
  // Loads Vidstack on demand and releases media resources when unmounted
  import { onMount } from 'svelte';
  import type { MediaPlayerElement } from 'vidstack/elements';
  import type { VideoMimeType, VideoSrc } from 'vidstack';
  import type { MediaAttachment } from './media-layout';
  import { Button, PlayIcon, LoaderCircleIcon } from '@kaordo/ui';

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
  let loadedURL = $state('');
  let loading = $state(false);
  let error = $state('');
  const lifetime = new AbortController();

  const source = $derived<VideoSrc>({
    src: media.url || loadedURL,
    type: normalizeMimeType(media.mimeType)
  });

  onMount(() => {
    let active = true;

    void loadVidstack().then(() => {
      if (active) registered = true;
    });

    return () => {
      active = false;
      lifetime.abort();
      releaseVideo(player);
    };
  });
  async function load() {
    if (!media.loadURL || loading) return;
    loading = true; error = '';
    try { loadedURL = await media.loadURL(lifetime.signal); }
    catch (cause) { if (!lifetime.signal.aborted) error = cause instanceof Error ? cause.message : 'The video could not load.'; }
    finally { loading = false; }
  }

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
  {#if media.loadURL && !loadedURL}
    <div class="grid h-full w-full place-items-center p-4 text-center text-white">
      <div><Button variant="ghost" class="size-14 rounded-full bg-white/15 text-white hover:bg-white/25" aria-label={loading ? 'Opening encrypted video' : 'Load encrypted video'} disabled={loading} onclick={load}>{#if loading}<LoaderCircleIcon class="size-7 motion-safe:animate-spin" />{:else}<PlayIcon class="size-7 fill-current" />{/if}</Button>{#if error}<p role="alert" class="mt-3 max-w-xs text-xs">{error}</p>{/if}</div>
    </div>
  {:else if registered}
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
