<script lang="ts">
  import { onMount } from 'svelte';
  import type { DesegnDrawing } from '../../../lib/domain/desegnLernado';
  import type { IloGState } from '../../../lib/states/IloGState';

  type Props = {
    drawing: Readonly<DesegnDrawing>;
    eager?: boolean;
    state: IloGState;
  };

  let { drawing, eager = false, state: iloState }: Props = $props();
  let host: HTMLDivElement;
  let url = $state<string | null>(null);
  let failed = $state(false);
  let loaded = $state(false);

  onMount(() => {
    let disposed = false;
    const load = () => {
      void iloState.desegnLernadoMediaUrl(drawing.id, 'thumbnail').then((next) => {
        if (disposed) return;
        url = next;
        failed = next === null;
      });
    };
    if (eager || typeof IntersectionObserver === 'undefined') {
      load();
      return () => { disposed = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '520px 0px' });
    observer.observe(host);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  });
</script>

<div
  bind:this={host}
  class:failed
  class:loaded
  class="drawing-thumbnail"
  style={`--drawing-ratio:${drawing.width} / ${drawing.height}`}
>
  {#if url}
    <img
      alt={drawing.title}
      decoding="async"
      loading={eager ? 'eager' : 'lazy'}
      src={url}
      onload={() => { loaded = true; }}
      onerror={() => { failed = true; }}
    />
  {:else if failed}
    <span aria-label="Preview unavailable">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v13H4zM7 15l3.2-3.4 2.6 2.5 1.8-1.8 2.4 2.7M8 9h.01"/></svg>
      Preview unavailable
    </span>
  {:else}
    <i aria-hidden="true"></i>
  {/if}
</div>

<style>
  .drawing-thumbnail {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 120px;
    overflow: hidden;
    background: color-mix(in srgb, var(--sui-bg-dark) 58%, var(--sui-bg));
    place-items: center;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transform: scale(1.015);
    transition: opacity 240ms ease, transform 360ms cubic-bezier(.2, .8, .2, 1);
  }

  .loaded img { opacity: 1; transform: none; }

  i {
    width: 54%;
    height: 18px;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sui-bg-light) 75%, white 25%), transparent);
    filter: blur(5px);
    animation: shimmer 1.15s ease-in-out infinite;
  }

  span {
    display: grid;
    justify-items: center;
    gap: 8px;
    color: var(--sui-text-light);
    font-size: calc(8px * var(--text-scale));
  }

  svg {
    width: 27px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  @keyframes shimmer {
    50% { opacity: .35; transform: translateX(24px); }
  }

  @media (prefers-reduced-motion: reduce) {
    i { animation: none; }
    img { transition: none; }
  }
</style>
