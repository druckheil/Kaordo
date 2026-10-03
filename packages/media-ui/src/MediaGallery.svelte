<script lang="ts">
  // Renders responsive post media with carousel and image lightbox support
  import { onMount } from 'svelte';
  import type { EmblaCarouselType } from 'embla-carousel';
  import useEmblaCarousel from 'embla-carousel-svelte';
  import { Button, ChevronLeftIcon, ChevronRightIcon } from '@kaordo/ui';
  import type { MediaAttachment } from './media-layout';
  import {
    maxMediaHeightRem,
    maxMediaRatio,
    mediaFrameRatio,
    mediaGapPx,
    mediaPositionLabel,
    mediaStripMaxWidth,
    minMediaRatio
  } from './media-layout';
  import { mountPhotoSwipe } from './photo-swipe';
  import VideoPlayer from './VideoPlayer.svelte';
  import 'photoswipe/style.css';

  interface Props {
    media: MediaAttachment[];
    label?: string;
  }

  let { media, label = 'Post media' }: Props = $props();
  let gallery = $state<HTMLDivElement>();
  let carousel = $state.raw<EmblaCarouselType | null>(null);
  let visible = $state<number[]>([0]);
  let canPrev = $state(false);
  let canNext = $state(false);

  const firstAttachment = $derived(media[0]);
  const ratios = $derived(media.map(mediaFrameRatio));
  const widestRatio = $derived(Math.max(1, ...ratios));
  const stripMaxWidth = $derived(mediaStripMaxWidth(ratios));
  const positionLabel = $derived(mediaPositionLabel(visible, media.length));

  const carouselOptions = {
    align: 'start' as const,
    containScroll: 'trimSnaps' as const,
    slidesToScroll: 'auto' as const,
    dragFree: true,
    inViewThreshold: 0.5,
    loop: false,
    duration: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 22
  };

  onMount(() => {
    if (!media.some(isImage)) return;
    return mountPhotoSwipe(gallery);
  });

  function isImage(item: MediaAttachment): boolean {
    return item.kind === 'image';
  }

  function isExtreme(item: MediaAttachment): boolean {
    const naturalRatio = item.width / item.height;
    return naturalRatio < minMediaRatio || naturalRatio > maxMediaRatio;
  }

  function imageAltText(item: MediaAttachment, index: number): string {
    if (item.altText) return item.altText;

    return `Image ${index + 1} attached to this ${mediaContext()}`;
  }

  function mediaContext(): string {
    if (label === 'Post media') return 'post';
    if (label === 'Reply media') return 'reply';
    return 'message';
  }

  function syncCarousel(api: EmblaCarouselType): void {
    const visibleSlides = api.slidesInView();
    if (visibleSlides.length) visible = visibleSlides;

    canPrev = api.canScrollPrev();
    canNext = api.canScrollNext();
  }

  function initialized(event: CustomEvent<EmblaCarouselType>): void {
    const api = event.detail;
    const sync = () => syncCarousel(api);

    carousel = api;
    api.on('select', sync);
    api.on('slidesInView', sync);
    api.on('reInit', sync);
    sync();
  }

  function scrollPrevious(): void {
    carousel?.scrollPrev();
  }

  function scrollNext(): void {
    carousel?.scrollNext();
  }
</script>

{#snippet attachment(item: MediaAttachment, index: number)}
  {#if isImage(item)}
    <a
      data-pswp-item
      href={item.url}
      data-pswp-width={item.width}
      data-pswp-height={item.height}
      data-cropped={isExtreme(item) ? 'true' : undefined}
      class="block h-full w-full overflow-hidden outline-offset-[-4px] focus-visible:rounded-xl focus-visible:outline-3 focus-visible:outline-ring"
      aria-label={`Open image ${index + 1} of ${media.length}`}
    >
      <img
        src={item.url}
        alt={imageAltText(item, index)}
        width={item.width}
        height={item.height}
        loading="lazy"
        decoding="async"
        draggable="false"
        class="block h-full w-full object-cover object-center"
      />
    </a>
  {:else}
    <VideoPlayer media={item} />
  {/if}
{/snippet}

{#if firstAttachment}
  <div bind:this={gallery} class="mt-4 w-full min-w-0" aria-label={`${label} attachments`}>
    {#if media.length === 1}
      <div
        class="mx-auto max-w-full overflow-hidden rounded-2xl ring-1 ring-border"
        style:width={`min(100%, ${maxMediaHeightRem * ratios[0]}rem)`}
        style:aspect-ratio={ratios[0]}
      >
        {@render attachment(firstAttachment, 0)}
      </div>
    {:else}
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        class="relative min-w-0 max-w-full"
        style:max-width={stripMaxWidth}
      >
        <div
          class="w-full overflow-hidden rounded-2xl"
          style:aspect-ratio={widestRatio}
          style:max-height={`${maxMediaHeightRem}rem`}
          use:useEmblaCarousel={{ options: carouselOptions, plugins: [] }}
          onemblaInit={initialized}
        >
          <div class="flex h-full touch-pan-y" style:gap={`${mediaGapPx}px`}>
            {#each media as item, index (item.id)}
              <div
                class="h-full shrink-0 overflow-hidden rounded-xl"
                style:aspect-ratio={ratios[index]}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${media.length}`}
              >
                {@render attachment(item, index)}
              </div>
            {/each}
          </div>
        </div>

        {#if canPrev || canNext}
          <div
            class="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2"
            class:justify-end={!canPrev && canNext}
            class:justify-start={canPrev && !canNext}
            class:justify-between={canPrev && canNext}
          >
            {#if canPrev}
              <Button
                class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm"
                size="icon"
                variant="secondary"
                aria-label="Previous attachment"
                onclick={scrollPrevious}
              >
                <ChevronLeftIcon class="size-5" />
              </Button>
            {/if}
            {#if canNext}
              <Button
                class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm"
                size="icon"
                variant="secondary"
                aria-label="Next attachment"
                onclick={scrollNext}
              >
                <ChevronRightIcon class="size-5" />
              </Button>
            {/if}
          </div>
        {/if}
      </div>

      <div class="mt-2 text-right text-xs font-medium text-muted-foreground" aria-live="polite">
        {positionLabel}
      </div>
    {/if}
  </div>
{/if}
