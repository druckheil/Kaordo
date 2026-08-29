<script lang="ts">
  import { onMount } from 'svelte';
  import type { FluoAttachment, FluoMediaOwner } from '../../lib/domain/fluo';
  import type { FluoGState } from '../../lib/states/FluoGState';
  import { FLUO_CAROUSEL_MEDIA_WIDTH } from './fluoMediaLayout';
  import FluoMedia from './FluoMedia.svelte';

  type Props = {
    active?: boolean;
    attachments: readonly FluoAttachment[];
    fluoState: FluoGState;
    mediaOwner?: FluoMediaOwner;
    maxWidth?: number;
    postIdentity?: string;
    postId: string;
    registerMedia: (load: () => Promise<void>) => () => void;
  };

  let {
    active = true,
    attachments,
    fluoState,
    mediaOwner,
    maxWidth = FLUO_CAROUSEL_MEDIA_WIDTH,
    postIdentity,
    postId,
    registerMedia,
  }: Props = $props();
  let scroller = $state<HTMLDivElement>();
  let track = $state<HTMLDivElement>();
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);
  let updateFrame = 0;

  onMount(() => {
    const element = scroller;
    if (!element) return;

    const scheduleUpdate = () => {
      if (updateFrame) return;
      updateFrame = requestAnimationFrame(() => {
        updateFrame = 0;
        updateScrollButtons();
      });
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleUpdate);

    element.addEventListener('scroll', scheduleUpdate, { passive: true });
    resizeObserver?.observe(element);
    if (track) resizeObserver?.observe(track);
    scheduleUpdate();

    return () => {
      element.removeEventListener('scroll', scheduleUpdate);
      resizeObserver?.disconnect();
      if (updateFrame) cancelAnimationFrame(updateFrame);
    };
  });

  $effect(() => {
    attachments.length;
    if (scroller) updateScrollButtons();
  });

  function updateScrollButtons(): void {
    if (!scroller) return;
    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    canScrollLeft = scroller.scrollLeft > 2;
    canScrollRight = scroller.scrollLeft < maxScrollLeft - 2;
  }

  function scrollByPage(direction: -1 | 1): void {
    if (!scroller) return;
    const distance = Math.max(220, scroller.clientWidth * 0.82);
    scroller.scrollBy({ behavior: 'smooth', left: direction * distance });
  }
</script>

<div class="post-media post-media--carousel">
  <div
    bind:this={scroller}
    class="media-carousel-scroller"
    aria-label="Post media"
    role="region"
  >
    <div bind:this={track} class="media-carousel-track">
      {#each attachments as attachment (`${postIdentity ?? postId}:${attachment.id}`)}
        <FluoMedia
          {attachment}
          {active}
          {fluoState}
          {mediaOwner}
          mediaIdentity={`${postIdentity ?? postId}:${attachment.id}`}
          {maxWidth}
          {postIdentity}
          {postId}
          register={registerMedia}
        />
      {/each}
    </div>
  </div>

  <button
    class:carousel-nav--hidden={!canScrollLeft}
    class="carousel-nav carousel-nav--left"
    type="button"
    aria-hidden={!canScrollLeft}
    aria-label="Show previous media"
    tabindex={canScrollLeft ? 0 : -1}
    disabled={!canScrollLeft}
    onclick={() => scrollByPage(-1)}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5.5 5.5 5.5 5.5" /></svg>
  </button>
  <button
    class:carousel-nav--hidden={!canScrollRight}
    class="carousel-nav carousel-nav--right"
    type="button"
    aria-hidden={!canScrollRight}
    aria-label="Show next media"
    tabindex={canScrollRight ? 0 : -1}
    disabled={!canScrollRight}
    onclick={() => scrollByPage(1)}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
  </button>
</div>

<style>
  .post-media--carousel {
    position: relative;
    width: 100%;
    max-width: 100%;
    margin-top: 11px;
  }

  .media-carousel-scroller {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    -ms-overflow-style: none;
    scrollbar-width: none;
    scroll-behavior: smooth;
    scroll-snap-type: x proximity;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }

  .media-carousel-scroller::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .media-carousel-track {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: max-content;
    min-width: 100%;
  }

  .media-carousel-track :global(figure) {
    flex: 0 0 auto;
    scroll-snap-align: start;
  }

  .carousel-nav {
    position: absolute;
    top: 50%;
    z-index: 2;
    display: grid;
    width: 32px;
    height: 32px;
    padding: 0;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 50%;
    box-shadow: 0 3px 8px var(--fluo-shadow-color, rgb(39 51 67 / 20%));
    cursor: pointer;
    place-items: center;
    transform: translateY(-50%);
    transition: opacity 180ms ease, transform 180ms ease, background 140ms ease,
      box-shadow 140ms ease;
  }

  .carousel-nav:hover:not(:disabled) {
    background: var(--sui-bg-light);
    box-shadow: inset 1px 1px 4px var(--fluo-shadow-color, rgb(39 51 67 / 18%));
    transform: translateY(-50%) scale(1.05);
  }

  .carousel-nav:active:not(:disabled) {
    box-shadow: inset 1px 1px 4px var(--fluo-shadow-color, rgb(39 51 67 / 18%));
    transform: translateY(-50%) scale(.98);
  }

  .carousel-nav:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent);
    outline-offset: 2px;
  }

  .carousel-nav--left { left: 8px; }
  .carousel-nav--right { right: 8px; }

  .carousel-nav--hidden {
    pointer-events: none;
    opacity: 0;
  }

  .carousel-nav--left.carousel-nav--hidden { transform: translate(-6px, -50%); }
  .carousel-nav--right.carousel-nav--hidden { transform: translate(6px, -50%); }

  .carousel-nav svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  @media (prefers-reduced-motion: reduce) {
    .media-carousel-scroller { scroll-behavior: auto; }
    .carousel-nav { transition: none; }
  }
</style>
