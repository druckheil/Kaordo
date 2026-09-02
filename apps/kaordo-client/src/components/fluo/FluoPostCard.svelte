<script lang="ts">
  import { fluoPostKey, type FluoPost, type FluoQuote } from '../../lib/domain/fluo';
  import type { FluoGState } from '../../lib/states/FluoGState';
  import { openContextMenu } from '../../lib/ui/contextMenu';
  import FluoMedia from './FluoMedia.svelte';
  import FluoMediaCarousel from './FluoMediaCarousel.svelte';
  import FluoAuthorIdentity from './FluoAuthorIdentity.svelte';
  import FluoQuotedPost from './FluoQuotedPost.svelte';
  import { formatFluoPostDate } from './fluoPost';
  import { FLUO_POST_PREVIEW_LINES, shouldExpandFluoText } from './fluoText';

  type Props = {
    active?: boolean;
    expanded?: boolean;
    fluoState: FluoGState;
    onOpen?: () => void;
    onOpenQuote?: (quote: FluoQuote) => void;
    onQuote?: () => void;
    post: FluoPost;
    registerMedia: (load: () => Promise<void>) => () => void;
  };

  let {
    active = true,
    expanded = false,
    fluoState,
    onOpen,
    onOpenQuote,
    onQuote,
    post,
    registerMedia,
  }: Props = $props();
  let postIdentity = $derived(fluoPostKey(post));
  let likePending = $derived(fluoState.isLikePending?.(post.id, postIdentity) ?? post.likePending === true);
  let likeCount = $derived(post.likeCount ?? 0);
  let canExpand = $derived(shouldExpandFluoText(post.body));

  function menuLabel(): string {
    const body = post.body.trim();
    if (body) return body.length > 34 ? `${body.slice(0, 34)}…` : body;
    return `Post with ${post.attachments.length} media`;
  }

  function likeLabel(count: number): string {
    return `${count} ${count === 1 ? 'like' : 'likes'}`;
  }
</script>

<article
  class="post-card"
  oncontextmenu={(event) => openContextMenu(event, menuLabel(), [
    {
      action: async () => { await fluoState.deletePost(post.id); },
      confirmation: 'Delete this post?',
      danger: true,
      icon: 'delete',
      id: 'delete-fluo-post',
      label: 'Delete post',
    },
  ])}
>
  <FluoAuthorIdentity {active} author={post.author} {fluoState} />
  <div class="post-content">
    <header>
      <strong>{post.author}</strong>
      <span>@{post.author.toLowerCase()}</span>
      <i aria-hidden="true">·</i>
      <time datetime={new Date(post.createdAt).toISOString()}>{formatFluoPostDate(post.createdAt)}</time>
      <span class="post-node-mark" title={`Stored in ${post.space} space on Nodo ${post.nodeId}`}>
        {post.space === 'public' ? 'Public Nodo' : 'Private Nodo'}
      </span>
    </header>
    {#if post.body}
      <p
        class:post-body--collapsed={canExpand && !expanded}
        class="post-body"
        style={`--post-preview-lines:${FLUO_POST_PREVIEW_LINES}`}
      >{post.body}</p>
      {#if canExpand && !expanded}
        <button
          class="post-expand"
          type="button"
          aria-label="Show full post"
          aria-expanded="false"
          onclick={() => onOpen?.()}
        >Show full post</button>
      {/if}
    {/if}
    {#if post.attachments.length}
      {#if post.attachments.length === 1}
        <div
          class="post-media post-media--single"
          class:post-media--audio={post.attachments[0]!.kind === 'audio'}
        >
          {#key `${postIdentity}:${post.attachments[0]!.id}`}
            <FluoMedia
              attachment={post.attachments[0]!}
              {active}
              {fluoState}
              mediaIdentity={`${postIdentity}:${post.attachments[0]!.id}`}
              postId={post.id}
              register={registerMedia}
            />
          {/key}
        </div>
      {:else}
        {#key postIdentity}
          <FluoMediaCarousel
            attachments={post.attachments}
            {active}
            {fluoState}
            postIdentity={postIdentity}
            postId={post.id}
            registerMedia={registerMedia}
          />
        {/key}
      {/if}
    {/if}
    {#if post.quote}
      <FluoQuotedPost
        {active}
        {fluoState}
        onOpen={onOpenQuote ? () => onOpenQuote(post.quote!) : undefined}
        quote={post.quote}
        registerMedia={registerMedia}
      />
    {/if}
    <footer class="post-actions">
      <button type="button" disabled aria-label="Reply, coming later" title="Replies are coming later">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12v8H9l-3.5 3v-3H4z" /></svg>
      </button>
      <button type="button" disabled aria-label="Reflow, coming later" title="Reflow is coming later">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 5-2 2 2 2M4 7h9a3 3 0 0 1 3 3m-2 5 2-2-2-2m2 2H7a3 3 0 0 1-3-3" /></svg>
      </button>
      <button
        class="post-action--quote"
        type="button"
        aria-label="Quote post"
        title="Quote post"
        disabled={!onQuote}
        onclick={() => onQuote?.()}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5h3v3H5.5A1.5 1.5 0 0 1 4 12v-1.5c0-2.2 1.1-3.6 3.2-4.3M12 10.5h3v3h-1.5A1.5 1.5 0 0 1 12 12v-1.5c0-2.2 1.1-3.6 3.2-4.3" /></svg>
      </button>
      <button
        class="post-action--like"
        class:post-action--active={post.liked}
        type="button"
        aria-label={post.liked ? `Unlike post (${likeLabel(likeCount)})` : `Like post (${likeLabel(likeCount)})`}
        aria-pressed={post.liked}
        aria-busy={likePending}
        onclick={() => void fluoState.toggleLike(post.id, postIdentity)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16S4 12.6 4 8.2C4 5 8 4 10 6.7 12 4 16 5 16 8.2 16 12.6 10 16 10 16Z" /></svg>
        <span class="post-like-count">{likeCount}</span>
      </button>
    </footer>
  </div>
</article>

<style>
  .post-card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
    width: 100%;
    padding: 16px 18px 12px;
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius);
    box-shadow: 0 3px 8px var(--fluo-shadow-color, rgb(39 51 67 / 20%));
    contain: layout style;
    position: relative;
    overflow: visible;
    transition: box-shadow 150ms ease;
  }

  :global(.post-card:has(.author-profile--open)) { z-index: 10; }

  .post-card:hover { box-shadow: 0 5px 14px var(--fluo-shadow-color, rgb(39 51 67 / 20%)); }

  .post-content { min-width: 0; }
  .post-content > header { display: flex; align-items: center; gap: 5px; min-height: 18px; }
  .post-content > header strong { color: var(--sui-text); font-size: calc(11px * var(--text-scale)); font-weight: 690; }
  .post-content > header span,
  .post-content > header time,
  .post-content > header i { color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); font-style: normal; }

  .post-content > header .post-node-mark {
    margin-left: auto;
    padding: 4px 8px;
    color: var(--sui-primary);
    background: var(--sui-bg-light);
    border-radius: 999px;
    box-shadow: var(--sui-shadow-inset-sm);
    font-size: calc(8px * var(--text-scale));
    font-weight: 650;
  }

  .post-content > .post-body {
    margin-top: 7px;
    color: var(--sui-text);
    font-size: calc(12px * var(--text-scale));
    line-height: 1.62;
    overflow-wrap: anywhere;
    user-select: text;
    white-space: pre-wrap;
    -webkit-user-select: text;
  }

  .post-content > .post-body--collapsed {
    display: -webkit-box;
    max-height: calc(var(--post-preview-lines) * 1.62em);
    overflow: hidden;
    line-clamp: var(--post-preview-lines);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--post-preview-lines);
  }

  .post-expand {
    display: inline-flex;
    align-items: center;
    min-height: 27px;
    margin-top: 8px;
    padding: 0 10px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 9px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    font: inherit;
    font-size: calc(9px * var(--text-scale));
    font-weight: 680;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .post-expand:hover {
    color: var(--sui-primary-hover);
    box-shadow: var(--sui-shadow-raised-sm);
    transform: translateY(-1px);
  }

  .post-expand:active {
    box-shadow: var(--sui-shadow-inset-sm);
    transform: translateY(1px);
  }

  .post-expand:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent);
    outline-offset: 3px;
  }

  .post-media {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
    width: 100%;
    margin-top: 11px;
    align-items: start;
    justify-items: start;
  }

  .post-media--single {
    display: flex;
    width: fit-content;
    max-width: 100%;
    align-items: flex-start;
  }

  /* Native audio controls have a fairly wide intrinsic size. Give an audio
     attachment the full logical content width so that intrinsic sizing cannot
     push the player outside the post card. Other media keeps its natural
     bounded width. */
  .post-media--single.post-media--audio {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  .post-actions {
    display: grid;
    grid-template-columns: repeat(3, 32px) max-content;
    gap: 15px;
    margin-top: 10px;
  }

  .post-actions button {
    display: grid;
    width: 29px;
    height: 27px;
    padding: 0;
    color: var(--sui-text-muted);
    background: var(--sui-bg);
    border: 0;
    border-radius: 9px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    place-items: center;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease, background 140ms ease;
  }

  .post-actions button:hover:not(:disabled) { color: var(--sui-primary); background: var(--sui-bg-light); box-shadow: var(--sui-shadow-inset-sm); transform: translateY(-1px); }
  .post-actions button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .post-actions button:disabled { opacity: 0.42; cursor: default; box-shadow: none; }
  .post-actions .post-action--active { color: var(--sui-danger); background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg)); box-shadow: var(--sui-shadow-inset-sm); }
  .post-actions .post-action--like { display: flex; width: auto; min-width: 29px; gap: 3px; align-items: center; justify-content: center; padding-inline: 5px; }
  .post-actions .post-like-count { min-width: 1ch; color: currentColor; font-size: calc(8px * var(--text-scale)); font-variant-numeric: tabular-nums; line-height: 1; }
  .post-actions svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .post-actions .post-action--active svg { fill: currentColor; }

  @media (prefers-reduced-motion: reduce) {
    .post-card { transition: none; }
  }
</style>
