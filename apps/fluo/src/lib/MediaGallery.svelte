<script lang="ts">
  import { onMount } from 'svelte';
  import type { FluoMedia } from '@kaordo/contracts';
  import 'photoswipe/style.css';
  import VideoPlayer from './VideoPlayer.svelte';

  let { media }: { media: FluoMedia[] } = $props();
  let gallery = $state<HTMLDivElement>();
  onMount(() => {
    let lightbox: { init: () => void; destroy: () => void } | undefined;
    let active = true;
    void import('photoswipe/lightbox').then(({ default: PhotoSwipeLightbox }) => {
      if (!active) return;
      if (!gallery) return;
      lightbox = new PhotoSwipeLightbox({ gallery, children: 'a[data-pswp-item]', pswpModule: () => import('photoswipe') });
      lightbox.init();
    });
    return () => { active = false; lightbox?.destroy(); };
  });
</script>

{#if media.length > 0}
  <div bind:this={gallery} class="mt-4 grid gap-2" class:grid-cols-2={media.length > 1} aria-label="Post attachments">
    {#each media as item (item.id)}
      {#if item.kind === 'image'}
        <a data-pswp-item href={item.url} data-pswp-width={item.width} data-pswp-height={item.height}
          class="block overflow-hidden rounded-xl bg-muted" style:aspect-ratio={`${item.width}/${item.height}`}
          aria-label="Open image attachment">
          <img src={item.url} alt="Post attachment" width={item.width} height={item.height} loading="lazy" decoding="async"
            class="h-full w-full object-cover" />
        </a>
      {:else}
        <VideoPlayer media={item} />
      {/if}
    {/each}
  </div>
{/if}
