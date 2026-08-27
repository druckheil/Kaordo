<script lang="ts">
  import type {
    FluoGState,
    FluoMediaOwner,
    FluoQuote,
  } from '../../lib/states/FluoGState';
  import FluoMedia from './FluoMedia.svelte';
  import FluoMediaCarousel from './FluoMediaCarousel.svelte';

  type Props = {
    active?: boolean;
    fluoState: FluoGState;
    onOpen?: () => void;
    quote: FluoQuote;
    registerMedia: (load: () => Promise<void>) => () => void;
  };

  let {
    active = true,
    fluoState,
    onOpen,
    quote,
    registerMedia,
  }: Props = $props();

  let quoteIdentity = $derived(`${quote.space}:${quote.nodeId}:${quote.id}`);
  let mediaOwner = $derived<FluoMediaOwner>({
    id: quote.id,
    nodeId: quote.nodeId,
    space: quote.space,
  });

  function handleOpenClick(event: MouseEvent): void {
    if (!onOpen) return;
    if (event.target instanceof Element && event.target.closest('.quoted-post__media')) return;
    onOpen();
  }

  function handleOpenKeydown(event: KeyboardEvent): void {
    if (!onOpen || event.target !== event.currentTarget ||
        (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onOpen();
  }

  function postDate(value: number): string {
    const date = new Date(value);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
</script>

<div
  class="quoted-post"
  class:quoted-post--interactive={Boolean(onOpen)}
  role="button"
  tabindex={onOpen ? 0 : -1}
  aria-disabled={!onOpen}
  aria-label={onOpen ? 'Open quoted post' : 'Quoted post'}
  onclick={handleOpenClick}
  onkeydown={handleOpenKeydown}
>
  <header class="quoted-post__header">
    <span class="quoted-post__label">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 10.5h3v3H5.5A1.5 1.5 0 0 1 4 12v-1.5c0-2.2 1.1-3.6 3.2-4.3M12 10.5h3v3h-1.5A1.5 1.5 0 0 1 12 12v-1.5c0-2.2 1.1-3.6 3.2-4.3" />
      </svg>
      Quoted post
    </span>
    <span class="quoted-post__space">{quote.space === 'public' ? 'Public Nodo' : 'Private Nodo'}</span>
  </header>

  <div class="quoted-post__author">
    <span class="quoted-post__avatar" aria-hidden="true">Y</span>
    <strong>{quote.author}</strong>
    <span>@{quote.author.toLowerCase()}</span>
    <i aria-hidden="true">·</i>
    <time datetime={new Date(quote.createdAt).toISOString()}>{postDate(quote.createdAt)}</time>
  </div>

  {#if quote.body}
    <p class="quoted-post__body">{quote.body}</p>
  {:else if !quote.attachments.length}
    <p class="quoted-post__empty">Empty post</p>
  {/if}

  {#if quote.attachments.length}
    <div
      class="quoted-post__media"
      aria-label={`${quote.attachments.length} attached media`}
    >
      {#if quote.attachments.length === 1}
        <FluoMedia
          active={active}
          attachment={quote.attachments[0]!}
          fluoState={fluoState}
          mediaOwner={mediaOwner}
          mediaIdentity={`${quoteIdentity}:${quote.attachments[0]!.id}`}
          maxWidth={360}
          postIdentity={quoteIdentity}
          postId={quote.id}
          register={registerMedia}
        />
      {:else}
        <FluoMediaCarousel
          active={active}
          attachments={quote.attachments}
          fluoState={fluoState}
          mediaOwner={mediaOwner}
          maxWidth={280}
          postIdentity={quoteIdentity}
          postId={quote.id}
          registerMedia={registerMedia}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .quoted-post {
    min-width: 0;
    margin-top: 12px;
    padding: 11px 12px 12px;
    color: var(--sui-text);
    background: var(--sui-bg-light);
    border: 0;
    border-radius: var(--sui-radius-sm);
    box-shadow: var(--sui-shadow-raised-sm);
    transition: background 180ms ease, box-shadow 180ms ease, transform 180ms cubic-bezier(.2, .8, .2, 1);
  }

  .quoted-post--interactive {
    cursor: pointer;
  }

  .quoted-post--interactive:hover {
    background: var(--sui-bg);
    box-shadow: 0 7px 16px var(--fluo-shadow-color, rgb(39 51 67 / 20%));
    transform: translateY(-1px);
  }

  .quoted-post--interactive:active {
    background: var(--sui-bg-dark);
    box-shadow: var(--sui-shadow-inset-sm);
    transform: translateY(0) scale(.997);
  }

  .quoted-post--interactive:focus-visible {
    outline: none;
    box-shadow: var(--sui-shadow-raised-sm), inset 0 0 0 1px color-mix(in srgb, var(--sui-primary) 24%, transparent);
  }

  .quoted-post__header,
  .quoted-post__author {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 5px;
  }

  .quoted-post__header { justify-content: space-between; gap: 12px; }

  .quoted-post__label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--sui-primary);
    font-size: calc(8px * var(--text-scale));
    font-weight: 720;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .quoted-post__label svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .quoted-post__space {
    color: var(--sui-text-muted);
    font-size: calc(8px * var(--text-scale));
  }

  .quoted-post__author { margin-top: 8px; }

  .quoted-post__avatar {
    display: grid;
    width: 20px;
    height: 20px;
    color: var(--sui-bg);
    background: var(--sui-primary);
    border-radius: 6px;
    font-size: calc(8px * var(--text-scale));
    font-weight: 750;
    place-items: center;
  }

  .quoted-post__author strong,
  .quoted-post__author span:not(.quoted-post__avatar),
  .quoted-post__author time,
  .quoted-post__author i {
    overflow: hidden;
    color: var(--sui-text-muted);
    font-size: calc(9px * var(--text-scale));
    font-style: normal;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quoted-post__author strong { color: var(--sui-text); font-weight: 700; }

  .quoted-post__body,
  .quoted-post__empty {
    margin: 8px 0 0 25px;
    color: var(--sui-text);
    font-size: calc(10px * var(--text-scale));
    line-height: 1.48;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .quoted-post__empty { color: var(--sui-text-muted); font-style: italic; }

  .quoted-post__media {
    max-width: calc(100% - 25px);
    margin: 10px 0 0 25px;
    overflow: hidden;
    border-radius: var(--sui-radius-sm);
  }

  .quoted-post__media :global(.post-media--carousel) {
    margin-top: 0;
  }

  .quoted-post__media :global(figure) {
    border-radius: var(--sui-radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .quoted-post { transition: none; }
  }
</style>
