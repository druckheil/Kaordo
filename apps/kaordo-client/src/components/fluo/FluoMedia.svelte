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
    mediaIdentity?: string;
    postIdentity?: string;
    postId: string;
    register: (load: () => Promise<void>) => () => void;
  };

  let {
    active = true,
    attachment,
    fluoState,
    maxWidth = FLUO_MAX_MEDIA_WIDTH,
    mediaIdentity,
    postIdentity,
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
  let currentIdentity = $state(untrack(mediaStateIdentity));
  let requestGeneration = 0;

  // Use persisted metadata (or a dimension learned during an earlier mount)
  // for the first paint. Legacy posts fall back to a bounded 16:9 slot until
  // their actual intrinsic dimensions are known locally.
  let initialDimensions = $state(untrack(() => fluoState.getMediaDimensions?.(
    postId,
    attachment.id,
    postIdentity,
  ) ?? { height: attachment.height, width: attachment.width }));
  // The reserved box is intentionally immutable for this mount. The post
  // manifest carries source dimensions for newly-created media; old posts
  // without them use the same bounded fallback for both skeleton and content.
  // Intrinsic decode events are still recorded for future mounts/viewers, but
  // they must never change a row's height after it entered the timeline.
  const reservedLayout = $derived(getFluoMediaLayout(
    initialDimensions.width,
    initialDimensions.height,
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

  // Virtualized rows can survive a feed update while receiving another post.
  // Reset all per-media state before handling the new attachment, otherwise a
  // resolved URL from the previous row is displayed for the new post. The
  // generation also prevents late network/decode work from winning a race.
  $effect(() => {
    const nextIdentity = mediaStateIdentity();
    if (nextIdentity !== currentIdentity) {
      currentIdentity = nextIdentity;
      requestGeneration += 1;
      initialDimensions = fluoState.getMediaDimensions?.(
        postId,
        attachment.id,
        postIdentity,
      ) ?? { height: attachment.height, width: attachment.width };
      mediaUrl = undefined;
      loadState = 'idle';
      loadingRequest = null;
      retrying = false;
      automaticRetryUsed = false;
      discoveredDimensions = undefined;
      showPhotoViewer = false;
    }

    // Locally published media already carries an object URL. Synchronize that
    // exceptional path without pushing remote-media progress through posts[].
    const directUrl = attachment.url;
    if (!directUrl || directUrl === mediaUrl) return;
    mediaUrl = directUrl;
    loadState = 'ready';
    if (attachment.kind !== 'video' && (!attachment.width || !attachment.height)) {
      const generation = requestGeneration;
      void discoverImageDimensions(directUrl).then((dimensions) => {
        if (generation !== requestGeneration || !isCurrentIdentity()) return;
        if (dimensions) applyMediaDimensions(dimensions.width, dimensions.height);
      });
    }
  });

  function ensureLoaded(): Promise<void> {
    if (mediaUrl) return Promise.resolve();
    if (loadingRequest) return loadingRequest;
    const generation = requestGeneration;
    const targetPostId = postId;
    const targetAttachmentId = attachment.id;
    loadState = 'loading';
    let request: Promise<void>;
    request = fluoState.loadMedia(targetPostId, targetAttachmentId, postIdentity).then(async (url) => {
      if (generation !== requestGeneration || !isCurrentIdentity()) return;
      if (url) {
        if (attachment.kind !== 'video' && (!attachment.width || !attachment.height)) {
          const dimensions = await discoverImageDimensions(url);
          if (generation !== requestGeneration || !isCurrentIdentity()) return;
          if (dimensions) applyMediaDimensions(dimensions.width, dimensions.height);
        }
        if (generation !== requestGeneration || !isCurrentIdentity()) return;
        mediaUrl = url;
        loadState = 'ready';
      } else {
        loadState = 'error';
      }
    }).catch(() => {
      if (generation === requestGeneration && isCurrentIdentity()) {
        mediaUrl = undefined;
        loadState = 'error';
      }
    }).finally(() => {
      if (loadingRequest === request) loadingRequest = null;
    });
    loadingRequest = request;
    return request;
  }

  function retry(): Promise<void> {
    if (retrying) return loadingRequest ?? Promise.resolve();
    retrying = true;
    mediaUrl = undefined;
    loadState = 'loading';
    const generation = requestGeneration;
    const targetPostId = postId;
    const targetAttachmentId = attachment.id;
    let request: Promise<void>;
    request = fluoState.retryMedia(targetPostId, targetAttachmentId, postIdentity).then(async (url) => {
      if (generation !== requestGeneration || !isCurrentIdentity()) return;
      if (url) {
        if (attachment.kind !== 'video') {
          const dimensions = await discoverImageDimensions(url);
          if (generation !== requestGeneration || !isCurrentIdentity()) return;
          if (dimensions) applyMediaDimensions(dimensions.width, dimensions.height);
        }
        if (generation !== requestGeneration || !isCurrentIdentity()) return;
        mediaUrl = url;
        loadState = 'ready';
      } else {
        loadState = 'error';
      }
    }).catch(() => {
      if (generation === requestGeneration && isCurrentIdentity()) {
        mediaUrl = undefined;
        loadState = 'error';
      }
    }).finally(() => {
      if (loadingRequest === request) {
        loadingRequest = null;
        retrying = false;
      }
    });
    loadingRequest = request;
    return request;
  }

  function isCurrentIdentity(): boolean {
    return currentIdentity === mediaStateIdentity();
  }

  function mediaStateIdentity(): string {
    return [
      mediaIdentity ?? postId,
      attachment.id,
      attachment.kind,
      attachment.mimeType,
      attachment.name,
      attachment.size,
    ].join(':');
  }

  function handleImageError(): void {
    if (automaticRetryUsed) {
      fluoState.markMediaUnavailable(postId, attachment.id, postIdentity);
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
    fluoState.setMediaDimensions(postId, attachment.id, width, height, postIdentity);
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
    border: 0;
    border-radius: var(--sui-radius-sm);
    background: var(--sui-bg-dark);
    box-shadow: var(--sui-shadow-inset-sm);
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
    outline: 2px solid var(--sui-primary);
    outline-offset: -2px;
  }

  .media-skeleton {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(145deg, var(--sui-bg-dark), var(--sui-bg-light));
  }

  .media-retry {
    display: flex;
    width: 100%;
    height: 100%;
    border: 0;
    color: var(--sui-text-muted);
    background: var(--sui-bg-light);
    box-shadow: var(--sui-shadow-inset-sm);
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
    color: var(--sui-text);
    background: color-mix(in srgb, var(--sui-bg-light) 88%, transparent);
    border-radius: 999px;
    box-shadow: 0 3px 8px var(--fluo-shadow-color, rgb(39 51 67 / 20%));
    font-size: calc(8px * var(--text-scale));
    font-weight: 750;
  }

</style>
