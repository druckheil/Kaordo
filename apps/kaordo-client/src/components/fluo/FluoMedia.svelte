<script lang="ts">
  import { tick } from 'svelte';
  import type { FluoAttachment, FluoGState } from '../../lib/states/FluoGState';

  type Props = {
    attachment: FluoAttachment;
    fluoState: FluoGState;
    postId: string;
  };

  let { attachment, fluoState, postId }: Props = $props();
  let container = $state<HTMLElement>();
  let video = $state<HTMLVideoElement>();

  // Keep this effect reactive to refreshed attachment objects. A keyed post
  // can survive a feed refresh, so onMount alone would leave its new idle
  // media stuck on a skeleton until virtualization remounted the component.
  $effect(() => {
    const element = container;
    const loadState = attachment.loadState;
    const url = attachment.url;
    if (!element || attachment.kind === 'video' || url || (loadState && loadState !== 'idle')) return;
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

  async function playVideo() {
    if (!attachment.url) await fluoState.loadMedia(postId, attachment.id);
    await tick();
    await video?.play().catch(() => undefined);
  }

  function mediaBytes(value: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
    return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }
</script>

<figure bind:this={container} class:media-unavailable={attachment.loadState === 'error'}>
  {#if attachment.kind === 'video'}
    {#if attachment.url}
      <!-- svelte-ignore a11y_media_has_caption: uploaded videos currently have no separate caption track -->
      <video
        bind:this={video}
        src={attachment.url}
        controls
        preload="metadata"
        playsinline
        aria-label={attachment.name}
      ></video>
    {:else}
      <button
        class="video-loader"
        type="button"
        disabled={attachment.loadState === 'loading'}
        aria-label={`Play ${attachment.name}`}
        onclick={playVideo}
      >
        <i aria-hidden="true">
          {#if attachment.loadState === 'loading'}<span></span>{:else}<svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z"/></svg>{/if}
        </i>
        <strong>{attachment.loadState === 'loading' ? 'Connecting…' : 'Play video'}</strong>
        <small>{mediaBytes(attachment.size)} · streams from Nodo</small>
      </button>
    {/if}
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

  img,
  video {
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

  .video-loader,
  .media-retry {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 148px;
    border: 0;
    color: #eaf3ef;
    background: radial-gradient(circle at 50% 35%, #42685c, #1f2c27 72%);
    cursor: pointer;
  }

  .video-loader {
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 5px;
  }

  .video-loader i {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: 5px;
    border: 1px solid rgb(255 255 255 / 35%);
    border-radius: 50%;
    background: rgb(255 255 255 / 16%);
    backdrop-filter: blur(8px);
  }

  .video-loader svg { width: 23px; fill: currentColor; }
  .video-loader strong { font-size: calc(13px * var(--text-scale)); }
  .video-loader small { color: rgb(234 243 239 / 68%); font-size: calc(9px * var(--text-scale)); }
  .video-loader:disabled { cursor: wait; }

  .video-loader i span {
    width: 17px;
    height: 17px;
    border: 2px solid rgb(255 255 255 / 25%);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .media-retry {
    align-items: center;
    justify-content: center;
    color: #52625a;
    background: #edf1ee;
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
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
