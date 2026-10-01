<script lang="ts">
  import { onMount } from 'svelte';
  import type { EmblaCarouselType } from 'embla-carousel';
  import useEmblaCarousel from 'embla-carousel-svelte';
  import type { MediaAttachment } from './media-layout';
  import { Button, ChevronLeftIcon, ChevronRightIcon } from '@kaordo/ui';
  import 'photoswipe/style.css';
  import VideoPlayer from './VideoPlayer.svelte';
  import { maxMediaHeightRem, maxMediaRatio, mediaFrameRatio, mediaGapPx, minMediaRatio } from './media-layout';

  let { media, label = 'Post media' }: { media: MediaAttachment[]; label?: string } = $props();
  let gallery = $state<HTMLDivElement>();
  let carousel = $state.raw<EmblaCarouselType | null>(null);
  let visible = $state<number[]>([0]);
  let canPrev = $state(false);
  let canNext = $state(false);

  const first = $derived(media[0]);
  const ratios = $derived(media.map(mediaFrameRatio));
  const widestRatio = $derived(Math.max(1, ...ratios));
  const maxStripWidth = $derived(`calc(${maxMediaHeightRem * ratios.reduce((sum, ratio) => sum + ratio, 0)}rem + ${Math.max(0, media.length - 1) * mediaGapPx}px)`);
  const positionLabel = $derived(visible.length > 1
    ? `${visible[0] + 1}–${visible[visible.length - 1] + 1} / ${media.length}`
    : `${(visible[0] ?? 0) + 1} / ${media.length}`);

  const options = {
    align: 'start' as const,
    containScroll: 'trimSnaps' as const,
    slidesToScroll: 'auto' as const,
    dragFree: true,
    inViewThreshold: 0.5,
    loop: false,
    duration: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 22
  };

  function isExtreme(item: MediaAttachment): boolean {
    const natural = item.width / item.height;
    return natural < minMediaRatio || natural > maxMediaRatio;
  }

  function initialized(event: CustomEvent<EmblaCarouselType>) {
    const api = event.detail;
    carousel = api;
    const sync = () => {
      const inView = api.slidesInView();
      if (inView.length) visible = inView;
      canPrev = api.canScrollPrev();
      canNext = api.canScrollNext();
    };
    api.on('select', sync);
    api.on('slidesInView', sync);
    api.on('reInit', sync);
    sync();
  }

  onMount(() => {
    if (!media.some((item) => item.kind === 'image') || !gallery) return;
    let lightbox: { init: () => void; destroy: () => void } | undefined;
    let active = true;
    void import('photoswipe/lightbox').then(({ default: PhotoSwipeLightbox }) => {
      if (!active || !gallery) return;
      lightbox = new PhotoSwipeLightbox({ gallery, children: 'a[data-pswp-item]', pswpModule: () => import('photoswipe') });
      lightbox.init();
    });
    return () => { active = false; lightbox?.destroy(); };
  });
</script>

{#snippet attachment(item: MediaAttachment, index: number)}
  {#if item.kind === 'image'}
    <a data-pswp-item href={item.url} data-pswp-width={item.width} data-pswp-height={item.height}
      data-cropped={isExtreme(item) ? 'true' : undefined}
      class="block h-full w-full overflow-hidden outline-offset-[-4px] focus-visible:rounded-xl focus-visible:outline-3 focus-visible:outline-ring"
      aria-label={'Open image ' + (index + 1) + ' of ' + media.length}>
      <img src={item.url} alt={item.altText || 'Image ' + (index + 1) + ' attached to this ' + (label === 'Post media' ? 'post' : 'message')} width={item.width} height={item.height}
        loading="lazy" decoding="async" draggable="false" class="block h-full w-full object-cover object-center" />
    </a>
  {:else}
    <VideoPlayer media={item} />
  {/if}
{/snippet}

{#if first}
  <div bind:this={gallery} class="mt-4 w-full min-w-0" aria-label={label + ' attachments'}>
    {#if media.length === 1}
      <div class="mx-auto max-w-full overflow-hidden rounded-2xl ring-1 ring-border"
        style:width={`min(100%, ${maxMediaHeightRem * ratios[0]}rem)`} style:aspect-ratio={ratios[0]}>
        {@render attachment(first, 0)}
      </div>
    {:else}
      <div role="region" aria-roledescription="carousel" aria-label={label} class="relative min-w-0 max-w-full"
        style:max-width={maxStripWidth}>
        <div class="w-full overflow-hidden rounded-2xl"
          style:aspect-ratio={widestRatio} style:max-height={`${maxMediaHeightRem}rem`}
          use:useEmblaCarousel={{ options, plugins: [] }} onemblaInit={initialized}>
          <div class="flex h-full touch-pan-y" style:gap={`${mediaGapPx}px`}>
            {#each media as item, index (item.id)}
              <div class="h-full shrink-0 overflow-hidden rounded-xl" style:aspect-ratio={ratios[index]}
                role="group" aria-roledescription="slide" aria-label={(index + 1) + ' of ' + media.length}>
                {@render attachment(item, index)}
              </div>
            {/each}
          </div>
        </div>
        {#if canPrev || canNext}
          <div class="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2"
            class:justify-end={!canPrev && canNext}
            class:justify-start={canPrev && !canNext}
            class:justify-between={canPrev && canNext}>
            {#if canPrev}
              <Button class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm" size="icon"
                variant="secondary" aria-label="Previous attachment"
                onclick={() => carousel?.scrollPrev()}><ChevronLeftIcon class="size-5" /></Button>
            {/if}
            {#if canNext}
              <Button class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm" size="icon"
                variant="secondary" aria-label="Next attachment"
                onclick={() => carousel?.scrollNext()}><ChevronRightIcon class="size-5" /></Button>
            {/if}
          </div>
        {/if}
      </div>
      <div class="mt-2 text-right text-xs font-medium text-muted-foreground" aria-live="polite">{positionLabel}</div>
    {/if}
  </div>
{/if}
