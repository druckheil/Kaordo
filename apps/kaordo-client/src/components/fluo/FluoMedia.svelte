<script lang="ts">
  import type { FluoAttachment, FluoGState } from '../../lib/states/FluoGState';
  import KaordoVideoPlayer from '../ui/KaordoVideoPlayer.svelte';

  type Props = {
    attachment: FluoAttachment;
    fluoState: FluoGState;
    postId: string;
  };

  let { attachment, fluoState, postId }: Props = $props();
  let container = $state<HTMLElement>();

  // Keep this effect reactive to refreshed attachment objects. A keyed post
  // can survive a feed refresh, so onMount alone would leave its new idle
  // media stuck on a skeleton until virtualization remounted the component.
  $effect(() => {
    const element = container;
    const loadState = attachment.loadState;
    const url = attachment.url;
    if (!element || url || (loadState && loadState !== 'idle')) return;
    if (typeof IntersectionObserver === 'undefined') {
      void fluoState.loadMedia(postId, attachment.id);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
      observer.disconnect();
      void fluoState.loadMedia(postId, attachment.id);
    }, {
      root: element.closest('.fluo-shell'),
      // Fetch the media while it is still well ahead of the viewport. The
      // surrounding virtual window keeps this bounded, while the browser's
      // native loader streams and caches the immutable response.
      rootMargin: '1800px 0px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

</script>

<figure bind:this={container} class:media-unavailable={attachment.loadState === 'error'}>
  {#if attachment.kind === 'video'}
    <KaordoVideoPlayer
      mimeType={attachment.mimeType}
      src={attachment.url ?? ''}
      title={attachment.name}
    />
  {:else if attachment.url}
    <img src={attachment.url} alt={attachment.name} decoding="async" />
  {:else if attachment.loadState === 'error'}
    <button class="media-retry" type="button" onclick={() => fluoState.loadMedia(postId, attachment.id)}>
      Media unavailable · Retry
    </button>
  {:else}
    <span class="media-skeleton" aria-label={`Loading ${attachment.name}`}></span>
  {/if}
  {#if attachment.kind === 'gif'}<span class="media-kind">GIF</span>{/if}
</figure>

<style>
  figure {
    position: relative;
    min-width: 0;
    min-height: 148px;
    aspect-ratio: 16 / 9;
    margin: 0;
    overflow: hidden;
    background: #e9eeea;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 148px;
    max-height: 430px;
    object-fit: cover;
  }

  .media-skeleton {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 148px;
    background: linear-gradient(105deg, #e7ece8 20%, #f5f7f5 38%, #e7ece8 56%);
    background-size: 220% 100%;
    animation: shimmer 1.35s linear infinite;
  }

  .media-retry {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 148px;
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

  @keyframes shimmer { to { background-position: -220% 0; } }
</style>
