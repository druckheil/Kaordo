<script lang="ts">
  import { onMount } from 'svelte';
  import type { FluoAttachment, FluoGState } from '../../lib/states/FluoGState';
  import KaordoVideoPlayer from '../ui/KaordoVideoPlayer.svelte';

  type Props = {
    attachment: FluoAttachment;
    fluoState: FluoGState;
    postId: string;
    register: (load: () => Promise<void>) => () => void;
  };

  let { attachment, fluoState, postId, register }: Props = $props();
  let retrying = $state(false);
  let automaticRetryUsed = $state(false);
  let mediaUrl = $state<string>();
  let loadState = $state<'error' | 'idle' | 'loading' | 'ready'>('idle');
  let loadingRequest: Promise<void> | null = null;

  const MIN_MEDIA_HEIGHT = 148;
  const MAX_MEDIA_HEIGHT = 430;
  const MAX_MEDIA_WIDTH = 520;
  let mediaRatio = $derived(validRatio(attachment.width, attachment.height));
  let mediaWidth = $derived(displayWidth(attachment.width, mediaRatio));

  onMount(() => register(ensureLoaded));

  // Locally published media already carries an object URL. Synchronize that
  // exceptional path without pushing remote-media progress through posts[].
  $effect(() => {
    if (!attachment.url || attachment.url === mediaUrl) return;
    mediaUrl = attachment.url;
    loadState = 'ready';
  });

  function validRatio(width?: number, height?: number): number {
    if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return 16 / 9;
    return Math.min(4, Math.max(0.35, width / height));
  }

  function displayWidth(width: number | undefined, ratio: number): number {
    const minimum = MIN_MEDIA_HEIGHT * ratio;
    const maximum = Math.min(MAX_MEDIA_WIDTH, MAX_MEDIA_HEIGHT * ratio);
    return Math.round(Math.min(maximum, Math.max(minimum, width ?? maximum)));
  }

  function ensureLoaded(): Promise<void> {
    if (mediaUrl) return Promise.resolve();
    if (loadingRequest) return loadingRequest;
    loadState = 'loading';
    loadingRequest = fluoState.loadMedia(postId, attachment.id).then((url) => {
      if (url) {
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
    loadingRequest = fluoState.retryMedia(postId, attachment.id).then((url) => {
      if (url) {
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

  function retryFromButton(): void {
    automaticRetryUsed = false;
    void retry();
  }
</script>

<figure
  class:media-unavailable={loadState === 'error'}
  style={`--media-ratio:${mediaRatio};--media-width:${mediaWidth}px`}
>
  {#if loadState === 'error'}
    <button class="media-retry" type="button" disabled={retrying} onclick={retryFromButton}>
      {retrying ? 'Retrying media…' : 'Media unavailable · Retry'}
    </button>
  {:else if attachment.kind === 'video' && mediaUrl}
    <KaordoVideoPlayer
      mimeType={attachment.mimeType}
      preload="none"
      src={mediaUrl}
      title={attachment.name}
    />
  {:else if attachment.kind !== 'video' && mediaUrl}
    <img src={mediaUrl} alt={attachment.name} decoding="async" onerror={handleImageError} />
  {:else}
    <span
      class="media-skeleton"
      aria-label={`Loading ${attachment.name}`}
    ></span>
  {/if}
  {#if attachment.kind === 'gif'}<span class="media-kind">GIF</span>{/if}
</figure>

<style>
  figure {
    position: relative;
    min-width: 0;
    width: min(100%, var(--media-width));
    aspect-ratio: var(--media-ratio);
    margin: 0;
    overflow: hidden;
    border: 1px solid #d8dfda;
    border-radius: 11px;
    background: #e9eeea;
    justify-self: start;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: left center;
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
