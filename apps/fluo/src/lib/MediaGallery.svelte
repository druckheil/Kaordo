<script lang="ts">
  import { onMount } from 'svelte';
  import type { EmblaCarouselType } from 'embla-carousel';
  import useEmblaCarousel from 'embla-carousel-svelte';
  import type { FluoMedia } from '@kaordo/contracts';
  import { Button, ChevronLeftIcon, ChevronRightIcon } from '@kaordo/ui';
  import 'photoswipe/style.css';
  import VideoPlayer from './VideoPlayer.svelte';

  let { media }: { media: FluoMedia[] } = $props();
  let gallery = $state<HTMLDivElement>();
  let carousel = $state.raw<EmblaCarouselType | null>(null);
  let selected = $state(0);
  const first = $derived(media[0]);
  const options = {
    align: 'start' as const,
    containScroll: 'trimSnaps' as const,
    loop: false,
    duration: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 22
  };

  function initialized(event: CustomEvent<EmblaCarouselType>) {
    carousel = event.detail;
    const sync = () => { selected = carousel?.selectedScrollSnap() ?? 0; };
    carousel.on('select', sync);
    carousel.on('reInit', sync);
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

{#snippet attachment(item: FluoMedia, index: number)}
  {#if item.kind === 'image'}
    <a data-pswp-item href={item.url} data-pswp-width={item.width} data-pswp-height={item.height}
      class="flex h-full w-full items-center justify-center outline-offset-[-4px] focus-visible:rounded-xl focus-visible:outline-3 focus-visible:outline-ring"
      tabindex={selected === index ? 0 : -1}
      aria-label={'Open image ' + (index + 1) + ' of ' + media.length}>
      <img src={item.url} alt={'Image ' + (index + 1) + ' attached to this post'} width={item.width} height={item.height}
        loading="lazy" decoding="async" class="h-full w-full object-contain" />
    </a>
  {:else}
    <VideoPlayer media={item} />
  {/if}
{/snippet}

{#if first}
  <div bind:this={gallery} class="mt-4 w-full min-w-0" aria-label="Post attachments">
    {#if media.length === 1}
      <div class="w-full min-w-0 max-w-full max-h-[34rem] min-h-48 overflow-hidden rounded-2xl border border-border bg-[#17251e]"
        style:aspect-ratio={first.width + '/' + first.height}>
        {@render attachment(first, 0)}
      </div>
    {:else}
      <div role="region" aria-roledescription="carousel" aria-label="Post media" class="relative">
        <div class="w-full min-w-0 max-w-full max-h-[34rem] min-h-48 overflow-hidden rounded-2xl border border-border bg-[#17251e]"
          style:aspect-ratio={first.width + '/' + first.height}
          use:useEmblaCarousel={{ options, plugins: [] }} onemblaInit={initialized}>
          <div class="flex h-full touch-pan-y">
            {#each media as item, index (item.id)}
              <div class="min-w-0 flex-[0_0_100%]" role="group" aria-roledescription="slide"
                aria-label={(index + 1) + ' of ' + media.length} inert={index !== selected}>
                {@render attachment(item, index)}
              </div>
            {/each}
          </div>
        </div>
        <div class="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2"
          class:justify-end={selected === 0}
          class:justify-start={selected === media.length - 1}
          class:justify-between={selected > 0 && selected < media.length - 1}>
          {#if selected > 0}
            <Button class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm" size="icon"
              variant="secondary" aria-label="Previous attachment"
              onclick={() => carousel?.scrollPrev()}><ChevronLeftIcon class="size-5" /></Button>
          {/if}
          {#if selected < media.length - 1}
            <Button class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm" size="icon"
              variant="secondary" aria-label="Next attachment"
              onclick={() => carousel?.scrollNext()}><ChevronRightIcon class="size-5" /></Button>
          {/if}
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2" aria-label="Choose attachment">
          {#each media as _, index}
            <button type="button" class="grid size-7 place-items-center rounded-full focus-visible:outline-3 focus-visible:outline-ring"
              aria-label={'Go to attachment ' + (index + 1)} aria-current={selected === index ? 'true' : undefined}
              onclick={() => carousel?.scrollTo(index)}>
              <span class={selected === index ? 'h-2 w-5 rounded-full bg-primary transition-all' : 'size-2 rounded-full bg-muted-foreground/50 transition-all'}></span>
            </button>
          {/each}
        </div>
        <span class="text-xs font-medium text-muted-foreground" aria-live="polite">{selected + 1} / {media.length}</span>
      </div>
    {/if}
  </div>
{/if}
