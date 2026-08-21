<script lang="ts">
  import type { VideoMimeType, VideoSrc } from 'vidstack';
  import type { MediaPlayerElement } from 'vidstack/elements';

  type Props = {
    mimeType?: string;
    onDimensions?: (width: number, height: number) => void;
    onError?: () => void;
    onReady?: () => void;
    preload?: 'metadata' | 'none' | 'auto';
    src: string;
    title: string;
  };

  let {
    mimeType = 'video/mp4',
    onDimensions,
    onError,
    onReady,
    preload = 'metadata',
    src,
    title,
  }: Props = $props();
  let player = $state<MediaPlayerElement>();
  let source = $derived<VideoSrc>({ src, type: normalizeMimeType(mimeType) });

  $effect(() => {
    const element = player;
    if (!element) return;

    const ready = () => {
      dimensions();
      onReady?.();
    };
    const failed = () => onError?.();
    const dimensions = () => {
      const video = element.querySelector('video');
      const width = video?.videoWidth ?? 0;
      const height = video?.videoHeight ?? 0;
      if (width > 0 && height > 0) onDimensions?.(width, height);
    };
    element.addEventListener('can-play', ready);
    element.addEventListener('media-error', failed);
    element.addEventListener('loaded-metadata', dimensions);
    element.addEventListener('loadedmetadata', dimensions);
    return () => {
      element.removeEventListener('can-play', ready);
      element.removeEventListener('media-error', failed);
      element.removeEventListener('loaded-metadata', dimensions);
      element.removeEventListener('loadedmetadata', dimensions);
    };
  });

  function normalizeMimeType(value: string): VideoMimeType {
    const type = value.split(';', 1)[0]?.trim().toLowerCase();
    if (type === 'video/webm') return 'video/webm';
    if (type === 'video/3gp') return 'video/3gp';
    if (type === 'video/ogg') return 'video/ogg';
    if (type === 'video/avi' || type === 'video/x-msvideo') return 'video/avi';
    if (type === 'video/mpeg') return 'video/mpeg';
    // QuickTime files still use the native media element for decoding. MP4 is
    // used only as a provider hint because Vidstack intentionally excludes
    // video/quicktime from its provider type union.
    return 'video/mp4';
  }
</script>

<media-player
  bind:this={player}
  class="kaordo-video-player"
  title={title}
  aria-label={title}
  src={source}
  viewType="video"
  playsinline
  preload={preload}
>
  <media-provider></media-provider>
  <media-video-layout></media-video-layout>
</media-player>

<style>
  .kaordo-video-player {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 148px;
    overflow: hidden;
    --media-brand: #4b8b76;
    --media-focus-color: #5fae91;
    --media-font-family: inherit;
    --media-font-size: 12px;
    --media-radius: 0;
  }
</style>
