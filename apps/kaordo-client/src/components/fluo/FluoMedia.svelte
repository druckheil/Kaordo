<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { FluoAttachment, FluoGState } from '../../lib/states/FluoGState';
  import KaordoVideoPlayer from '../ui/KaordoVideoPlayer.svelte';
  import PhotoViewer from '../ui/PhotoViewer.svelte';
  import {
    FLUO_MAX_MEDIA_WIDTH,
    getFluoMediaLayout,
    normalizeFluoMediaRatio,
  } from './fluoMediaLayout';

  type Props = {
    active?: boolean;
    attachment: FluoAttachment;
    fluoState: FluoGState;
    maxWidth?: number;
    postId: string;
    register: (load: () => Promise<void>) => () => void;
  };

  let {
    active = true,
    attachment,
    fluoState,
    maxWidth = FLUO_MAX_MEDIA_WIDTH,
    postId,
    register,
  }: Props = $props();
  let retrying = $state(false);
  let automaticRetryUsed = $state(false);
  let mediaUrl = $state<string>();
  let loadState = $state<'error' | 'idle' | 'loading' | 'ready'>('idle');
  let loadingRequest: Promise<void> | null = null;
  let discoveredDimensions = $state<{ height: number; width: number }>();
  let showPhotoViewer = $state(false);

  // Use persisted metadata (or a dimension learned during an earlier mount)
  // for the first paint. Legacy posts fall back to a bounded 16:9 slot until
  // their actual intrinsic dimensions are known locally.
  const initialDimensions = untrack(() => fluoState.getMediaDimensions?.(
    postId,
    attachment.id,
  ) ?? { height: attachment.height, width: attachment.width });
  // The reserved box is intentionally immutable for this mount. The post
  // manifest carries source dimensions for newly-created media; old posts
  // without them use the same bounded fallback for both skeleton and content.
  // Intrinsic decode events are still recorded for future mounts/viewers, but
  // they must never change a row's height after it entered the timeline.
  const reservedLayout = untrack(() => getFluoMediaLayout(
    attachment.width ?? initialDimensions.width,
    attachment.height ?? initialDimensions.height,
    maxWidth,
  ));
  // Keep the reserved height stable, but once intrinsic dimensions are known
  // let the box narrow/widen to the real ratio. This removes the old fallback
  // background beside portrait media without causing a vertical reflow.
  let mediaLayout = $derived.by(() => {
    if (!discoveredDimensions) return reservedLayout;
    const ratio = normalizeFluoMediaRatio(discoveredDimensions.width, discoveredDimensions.height);
    return {
      ...reservedLayout,
      ratio,
      width: Math.max(1, Math.round(Math.min(maxWidth, reservedLayout.height * ratio))),
    };
  });

  onMount(() => register(ensureLoaded));

  // Locally published media already carries an object URL. Synchronize that
  // exceptional path without pushing remote-media progress through posts[].
  $effect(() => {
    if (!attachment.url || attachment.url === mediaUrl) return;
    mediaUrl = attachment.url;
    loadState = 'ready';
    if (attachment.kind !== 'video' && (!attachment.width || !attachment.height)) {
      const directUrl = attachment.url;
      void discoverImageDimensions(directUrl).then((dimensions) => {
        if (dimensions) applyMediaDimensions(dimensions.width, dimensions.height);
      });
    }
  });

  function ensureLoaded(): Promise<void> {
    if (mediaUrl) return Promise.resolve();
    if (loadingRequest) return loadingRequest;
    loadState = 'loading';
    loadingRequest = fluoState.loadMedia(postId, attachment.id).then(async (url) => {
      if (url) {
        if (attachment.kind !== 'video' && (!attachment.width || !attachment.height)) {
          const dimensions = await discoverImageDimensions(url);
          if (dimensions) applyMediaDimensions(dimensions.width, dimensions.height);
        }
        mediaUrl = url;
        loadState = 'ready';
      } else {
        loadState = 'error';
      }
    }).finally(() => {
      loadingRequest = null;
    });
    return loadingRequest;
  }

  function retry(): Promise<void> {
    if (retrying) return loadingRequest ?? Promise.resolve();
    retrying = true;
    mediaUrl = undefined;
    loadState = 'loading';
    loadingRequest = fluoState.retryMedia(postId, attachment.id).then(async (url) => {
      if (url) {
        if (attachment.kind !== 'video') {
          const dimensions = await discoverImageDimensions(url);
          if (dimensions) applyMediaDimensions(dimensions.width, dimensions.height);
        }
        mediaUrl = url;
        loadState = 'ready';
      } else {
        loadState = 'error';
      }
    }).finally(() => {
      loadingRequest = null;
      retrying = false;
    });
    return loadingRequest;
  }

  function handleImageError(): void {
    if (automaticRetryUsed) {
      fluoState.markMediaUnavailable(postId, attachment.id);
      mediaUrl = undefined;
      loadState = 'error';
      return;
    }
    automaticRetryUsed = true;
    void retry();
  }

  function handleImageLoad(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      applyMediaDimensions(image.naturalWidth, image.naturalHeight);
    }
  }

  function handleVideoDimensions(width: number, height: number): void {
    applyMediaDimensions(width, height);
  }

  function applyMediaDimensions(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    discoveredDimensions = { height, width };
    fluoState.setMediaDimensions(postId, attachment.id, width, height);
  }

  async function discoverImageDimensions(url: string): Promise<{ height: number; width: number } | null> {
    if (typeof Image === 'undefined') return null;
    const probe = new Image();
    const dimensions = await new Promise<{ height: number; width: number } | null>((resolve) => {
      const finish = () => {
        const width = probe.naturalWidth;
        const height = probe.naturalHeight;
        resolve(width > 0 && height > 0 ? { height, width } : null);
      };
      probe.onload = finish;
      probe.onerror = () => resolve(null);
      probe.src = url;
      if (probe.complete) finish();
    });
    probe.onload = null;
    probe.onerror = null;
    probe.src = '';
    return dimensions;
  }

  function retryFromButton(): void {
    automaticRetryUsed = false;
    void retry();
  }
</script>

<figure
  class:media-unavailable={loadState === 'error'}
  style={`--media-ratio:${mediaLayout.ratio};--media-width:${mediaLayout.width}px;--media-height:${mediaLayout.height}px;width:${mediaLayout.width}px;height:${mediaLayout.height}px`}
>
  {#if loadState === 'error'}
    <button class="media-retry" type="button" disabled={retrying} onclick={retryFromButton}>
      {retrying ? 'Retrying media…' : 'Media unavailable · Retry'}
    </button>
  {:else if attachment.kind === 'video' && mediaUrl}
    <KaordoVideoPlayer
      {active}
      mimeType={attachment.mimeType}
      onDimensions={handleVideoDimensions}
      preload="none"
      src={mediaUrl}
      title={attachment.name}
    />
  {:else if attachment.kind !== 'video' && mediaUrl}
    <button
      class="image-trigger"
      type="button"
      aria-label={`Open ${attachment.name}`}
      onclick={() => { showPhotoViewer = true; }}
    >
      <img src={mediaUrl} alt={attachment.name} decoding="async" onerror={handleImageError} onload={handleImageLoad} />
    </button>
  {:else}
    <span
      class="media-skeleton"
      aria-label={`Loading ${attachment.name}`}
    ></span>
  {/if}
  {#if attachment.kind === 'gif'}<span class="media-kind">GIF</span>{/if}
</figure>

{#if showPhotoViewer && mediaUrl && attachment.kind !== 'video'}
  <PhotoViewer
    alt={attachment.name}
    height={discoveredDimensions?.height ?? attachment.height ?? mediaLayout.height}
    name={attachment.name}
    onClose={() => { showPhotoViewer = false; }}
    url={mediaUrl}
    width={discoveredDimensions?.width ?? attachment.width ?? mediaLayout.width}
  />
{/if}

<style>
  figure {
    position: relative;
    display: block;
    min-width: 0;
    width: var(--media-width);
    height: var(--media-height);
    max-width: 100%;
    aspect-ratio: var(--media-ratio);
    margin: 0;
    overflow: hidden;
    border: 1px solid #d8dfda;
    border-radius: 11px;
    background: #e9eeea;
    justify-self: start;
    align-self: start;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: left center;
  }

  .image-trigger {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: zoom-in;
  }

  .image-trigger:focus-visible {
    outline: 2px solid #4b8b76;
    outline-offset: -2px;
  }

  .media-skeleton {
    display: block;
    width: 100%;
    height: 100%;
    background: #e7ece8;
  }

  .media-retry {
    display: flex;
    width: 100%;
    height: 100%;
    border: 0;
    color: #52625a;
    background: #edf1ee;
    cursor: pointer;
  }

  .media-retry {
    align-items: center;
    justify-content: center;
  }

  .media-kind {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 3px 6px;
    color: white;
    background: rgb(20 29 25 / 72%);
    border-radius: 5px;
    font-size: calc(8px * var(--text-scale));
    font-weight: 750;
  }

</style>
