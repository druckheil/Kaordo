<script lang="ts">
  import { onMount } from 'svelte';
  import type { FluoGState, FluoPost, FluoQuote } from '../../lib/states/FluoGState';
  import FluoPostCard from './FluoPostCard.svelte';

  type Props = {
    backLabel?: string;
    fluoState: FluoGState;
    onClose: () => void;
    onOpenQuotedPost?: (quote: FluoQuote) => void;
    onQuote?: (post: FluoPost) => void;
    post: FluoPost;
  };

  let { backLabel = 'Back to timeline', fluoState, onClose, onOpenQuotedPost, onQuote, post }: Props = $props();
  let backButton = $state<HTMLButtonElement>();

  onMount(() => {
    backButton?.focus({ preventScroll: true });
  });
</script>

<section class="fluo-post-page" aria-labelledby="fluo-post-page-title">
  <header class="fluo-post-page__header">
    <button
      bind:this={backButton}
      class="fluo-post-page__back"
      type="button"
      aria-label={backLabel}
      onclick={onClose}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11.5 4.5-5.5 5.5 5.5 5.5M6.5 10h8" /></svg>
      <span>{backLabel}</span>
    </button>
    <h1 id="fluo-post-page-title">Post</h1>
    <span class="fluo-post-page__spacer" aria-hidden="true"></span>
  </header>

  <div class="fluo-post-page__scroll">
    <div class="fluo-post-page__content">
      <div class="fluo-post-page__card-surface">
        <FluoPostCard
          active
          expanded
          {fluoState}
          onOpenQuote={onOpenQuotedPost}
          onQuote={onQuote ? () => onQuote(post) : undefined}
          {post}
          registerMedia={(load) => {
            void load();
            return () => undefined;
          }}
        />
      </div>
    </div>
  </div>
</section>

<style>
  .fluo-post-page {
    position: absolute;
    inset: 0;
    z-index: 95;
    display: grid;
    grid-template-rows: 50px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    /* The page is a sibling of the feed viewport, so it cannot inherit the
       feed's scoped SoftUI variables. Keep its surface opaque and provide the
       same palette locally; otherwise the timeline remains visible through
       the detail page and card descendants lose their background. */
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --fluo-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--fluo-shadow-color) !important;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #d03a5c;
    --sui-warning: #f5a623;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-radius-sm: 10px;
    --sui-radius: 16px;
    --sui-radius-lg: 24px;
    --sui-shadow-raised: 0 5px 14px var(--fluo-shadow-color) !important;
    --sui-shadow-raised-sm: 0 3px 8px var(--fluo-shadow-color) !important;
    --sui-shadow-raised-lg: 0 16px 36px var(--fluo-shadow-color) !important;
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-dark);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark);
    color: var(--sui-text);
    background: var(--sui-bg);
    animation: fluo-post-page-enter 180ms ease-out both;
  }

  :global(html[data-theme='dark']) .fluo-post-page {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --fluo-shadow-color: rgb(0 0 0 / 42%);
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--fluo-shadow-color) !important;
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-warning: #f1bd63;
    --sui-text: #e2e8f0;
    --sui-text-muted: #9ba5b8;
    --sui-text-light: #8a94a6;
  }

  .fluo-post-page__header {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    min-height: 38px;
    margin: 6px 12px 0;
    padding: 0 14px;
    background: var(--sui-bg-light);
    border: 0;
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-raised);
  }

  .fluo-post-page__header h1 {
    margin: 0;
    color: var(--sui-text);
    font-size: calc(13px * var(--text-scale));
    font-weight: 720;
    letter-spacing: -.025em;
  }

  .fluo-post-page__back {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 7px;
    min-height: 30px;
    padding: 0 10px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 10px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    font: inherit;
    font-size: calc(8px * var(--text-scale));
    font-weight: 680;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .fluo-post-page__back:hover {
    color: var(--sui-primary-hover);
    box-shadow: var(--sui-shadow-raised-sm);
    transform: translateY(-1px);
  }

  .fluo-post-page__back:active {
    box-shadow: var(--sui-shadow-inset-sm);
    transform: translateY(1px);
  }

  .fluo-post-page__back:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent);
    outline-offset: 3px;
  }

  .fluo-post-page__back svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.65;
  }

  .fluo-post-page__spacer { min-width: 1px; }

  .fluo-post-page__scroll {
    position: relative;
    z-index: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 32px 28px 72px;
    overscroll-behavior: contain;
  }

  .fluo-post-page__content {
    width: min(100%, 820px);
    margin: 0 auto;
  }

  .fluo-post-page__card-surface {
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-raised-lg);
  }

  @keyframes fluo-post-page-enter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .fluo-post-page { animation: none; }
  }

  @media (max-width: 600px) {
    .fluo-post-page__header { margin-inline: 8px; padding-inline: 10px; }
    .fluo-post-page__back span { display: none; }
    .fluo-post-page__scroll { padding: 18px 14px 48px; }
  }
</style>
