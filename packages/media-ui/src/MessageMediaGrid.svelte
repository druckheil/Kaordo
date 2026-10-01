<script lang="ts">
  import { onMount } from 'svelte';
  import type { MediaAttachment } from './media-layout';
  import VideoPlayer from './VideoPlayer.svelte';
  import 'photoswipe/style.css';

  let { media }: { media: MediaAttachment[] } = $props();
  let gallery = $state<HTMLDivElement>();
  const columns = $derived(media.length === 1 ? 'grid-cols-1' :
    media.length === 2 ? 'grid-cols-2' : media.length === 3 ? 'grid-cols-2 sm:grid-cols-3' :
      media.length === 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4');

  onMount(() => {
    let active = true;
    let lightbox: { init: () => void; destroy: () => void } | undefined;
    if (media.some((item) => item.kind === 'image')) {
      void import('photoswipe/lightbox').then(({ default: PhotoSwipeLightbox }) => {
        if (!active || !gallery) return;
        lightbox = new PhotoSwipeLightbox({
          gallery, children: 'a[data-pswp-item]', pswpModule: () => import('photoswipe')
        });
        lightbox.init();
      });
    }
    return () => { active = false; lightbox?.destroy(); };
  });
</script>

{#if media.length}
  <div bind:this={gallery} class={`grid w-full min-w-0 gap-0.5 ${columns}`} aria-label="Message attachments">
    {#each media as item, index (item.id)}
      <figure class="min-w-0 overflow-hidden rounded-[10px] bg-background/70">
        <div class={`relative w-full overflow-hidden bg-muted ${media.length === 1 ? 'aspect-[4/3] max-h-80' : 'aspect-square'}`}>
          {#if item.kind === 'image'}
            <a data-pswp-item href={item.url} data-pswp-width={item.width} data-pswp-height={item.height}
              class="block h-full w-full focus-visible:outline-3 focus-visible:outline-ring"
              aria-label={`Open image ${index + 1} of ${media.length}`}>
              <img src={item.url} alt={item.altText || `Image ${index + 1} attached to this message`}
                width={item.width} height={item.height} loading="lazy" decoding="async"
                class="block h-full w-full object-cover object-center" />
            </a>
          {:else}
            <VideoPlayer media={item} compact />
          {/if}
        </div>
        {#if item.altText}
          <figcaption class="break-words px-2.5 py-2 text-xs leading-relaxed text-foreground/80">{item.altText}</figcaption>
        {/if}
      </figure>
    {/each}
  </div>
{/if}
