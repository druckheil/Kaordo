<script lang="ts">
  import { onMount } from 'svelte';
  import type { FluoMedia } from '@kaordo/contracts';
  import 'video.js/dist/video-js.css';

  let { media }: { media: FluoMedia } = $props();
  let element: HTMLVideoElement;
  let player = $state.raw<{ dispose: () => void; src: (sources: { src: string; type: string }[]) => void } | null>(null);
  let activeURL = '';
  $effect(() => {
    const url = media.url;
    if (player && url !== activeURL) {
      player.src([{ src: url, type: media.mimeType }]);
      activeURL = url;
    }
  });
  onMount(() => {
    let alive = true;
    void import('video.js').then(({ default: videojs }) => {
      if (!alive) return;
      activeURL = media.url;
      player = videojs(element, {
        controls: true, preload: 'metadata', fluid: true,
        sources: [{ src: media.url, type: media.mimeType }]
      });
    });
    return () => { alive = false; player?.dispose(); player = null; };
  });
</script>

<div class="overflow-hidden rounded-xl bg-black" style:aspect-ratio={`${media.width}/${media.height}`}>
  <video bind:this={element} class="video-js vjs-default-skin" playsinline aria-label="Video attachment"></video>
</div>
