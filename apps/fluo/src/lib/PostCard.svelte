<script lang="ts">
  import { createInfiniteQuery, type QueryClient } from '@tanstack/svelte-query';
  import { commentsOptions, type FluoApi } from '@kaordo/api-client';
  import type { FluoPost } from '@kaordo/contracts';
  import {
    BookmarkIcon, Button, MessageCircleIcon, Repeat2Icon, ThumbsDownIcon, ThumbsUpIcon, Trash2Icon, XIcon
  } from '@kaordo/ui';
  import MediaGallery from './MediaGallery.svelte';
  import QuotePreview from './QuotePreview.svelte';
  import RichText from './RichText.svelte';

  let { post, viewerId, api, queryClient, onReply, onQuote, onOpenPost, onReact, onFollow, onSave, onDelete }: {
    post: FluoPost;
    viewerId: string;
    api: FluoApi;
    queryClient: QueryClient;
    onReply: () => void;
    onQuote: () => void;
    onOpenPost: (id: string) => void;
    onReact: (value: 'good' | 'bad' | null) => Promise<void>;
    onFollow: () => Promise<void>;
    onSave: () => Promise<void>;
    onDelete: () => void;
  } = $props();
  let expanded = $state(false);
  let saving = $state(false);
  let reacting = $state(false);
  let following = $state(false);
  const comments = createInfiniteQuery(() => commentsOptions(api, post.id, expanded), () => queryClient);
  const date = $derived(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt)));
  const initials = $derived(post.author.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || post.author.username[0]?.toUpperCase() || 'K');

  async function toggleSaved() {
    if (saving) return;
    saving = true;
    try { await onSave(); } finally { saving = false; }
  }

  async function chooseReaction(value: 'good' | 'bad') {
    if (reacting) return;
    reacting = true;
    try { await onReact(post.myReaction === value ? null : value); } finally { reacting = false; }
  }

  async function toggleFollow() {
    if (following) return;
    following = true;
    try { await onFollow(); } finally { following = false; }
  }
</script>

<article data-post-id={post.id} class="fluo-post min-w-0 rounded-[1.5rem] border border-border bg-card p-4 shadow-[0_10px_32px_-25px_rgba(20,65,39,.5)] sm:p-6"
  aria-label={'Post by ' + post.author.username}>
  <header class="flex items-start gap-3">
    <div class="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-sm font-bold text-accent-foreground" aria-hidden="true">{initials}</div>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="truncate text-sm font-bold text-foreground">{post.author.displayName}</span>
        <span class="truncate text-xs text-muted-foreground">@{post.author.username}</span>
      </div>
      <p class="mt-0.5 text-xs text-muted-foreground">
        <time datetime={post.createdAt}>{date}</time>
        {#if post.visibility === 'private'}<span class="ml-1.5 rounded-full bg-muted px-2 py-0.5 font-medium">Only me</span>{/if}
      </p>
    </div>
    {#if post.author.id !== viewerId && post.visibility === 'public'}
      <Button variant={post.author.following ? 'secondary' : 'outline'} size="sm" disabled={following}
        aria-pressed={post.author.following} onclick={toggleFollow}>{post.author.following ? 'Following' : 'Follow'}</Button>
    {:else if post.author.id === viewerId}
      <Button variant="ghost" size="icon-sm" class="size-10" aria-label="Delete post" title="Delete post" onclick={onDelete}><Trash2Icon class="size-4" /></Button>
    {/if}
  </header>

  {#if post.text.trim()}<div class="mt-4"><RichText content={post.content} /></div>{/if}
  <MediaGallery media={post.media} />
  {#if post.quote}
    <QuotePreview quote={post.quote} onOpen={onOpenPost} />
  {:else if post.quoteId}
    <p class="mt-4 rounded-2xl border p-4 text-sm text-muted-foreground">Quoted post unavailable.</p>
  {/if}

  <div class="mt-5 grid grid-cols-4 gap-1.5 border-t border-border/80 pt-3 sm:gap-3" aria-label="Post actions">
    <div class:disliked={post.myReaction === 'bad'} class="reaction-control relative">
      <Button class="h-11 w-full min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant={post.myReaction === 'good' ? 'secondary' : 'ghost'}
        size="sm" aria-label={'Good, ' + post.counts.good} aria-pressed={post.myReaction === 'good'}
        disabled={reacting} onclick={() => chooseReaction('good')}>
        <ThumbsUpIcon class="size-4" /><span class="hidden text-xs sm:inline">Like</span><span class="text-xs tabular-nums">{post.counts.good}</span>
      </Button>
      <Button class="dislike-choice absolute -right-2 -top-10 z-10 rounded-full border border-border bg-card shadow-lg"
        variant={post.myReaction === 'bad' ? 'secondary' : 'outline'} size="icon-sm"
        aria-label={'Bad, ' + post.counts.bad} aria-pressed={post.myReaction === 'bad'}
        disabled={reacting} onclick={() => chooseReaction('bad')}><ThumbsDownIcon class={post.myReaction === 'bad' ? 'size-4 fill-current' : 'size-4'} /></Button>
    </div>
    <Button class="h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant="ghost"
      size="sm" aria-label="Reply to post" onclick={onReply}>
      <MessageCircleIcon class="size-4" /><span class="hidden text-xs sm:inline">Reply</span><span class="text-xs tabular-nums">{post.counts.comments}</span>
    </Button>
    {#if post.visibility === 'public'}
      <Button class="h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant="ghost" size="sm"
        aria-label="Quote post" onclick={onQuote}><Repeat2Icon class="size-4" /><span class="hidden text-xs sm:inline">Quote</span></Button>
    {:else}
      <span aria-hidden="true"></span>
    {/if}
    <Button class="h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant={post.saved ? 'secondary' : 'ghost'}
      size="sm" aria-label={post.saved ? 'Remove from saved posts' : 'Save post'} aria-pressed={post.saved}
      disabled={saving} onclick={toggleSaved}>
      <BookmarkIcon class={post.saved ? 'size-4 fill-current' : 'size-4'} />
      <span class="hidden text-xs sm:inline">{post.saved ? 'Saved' : 'Save'}</span>
    </Button>
  </div>

  {#if post.counts.comments > 0}
    <Button class="mt-2" variant="ghost" size="sm" aria-expanded={expanded}
      aria-controls={'comments-' + post.id} onclick={() => expanded = !expanded}>
      {expanded ? 'Hide replies' : `View ${post.counts.comments} ${post.counts.comments === 1 ? 'reply' : 'replies'}`}
    </Button>
  {/if}

  {#if expanded}
    <section id={'comments-' + post.id} class="comment-panel mt-4 rounded-2xl border border-border bg-muted/35 p-4 sm:p-5"
      aria-label="Replies">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-bold">Replies <span class="ml-1 font-medium text-muted-foreground">{post.counts.comments}</span></h3>
        <Button variant="ghost" size="icon-xs" aria-label="Close comments" onclick={() => expanded = false}><XIcon class="size-4" /></Button>
      </div>
      {#if comments.isPending}
        <p class="mt-5 text-sm text-muted-foreground" role="status">Loading replies…</p>
      {:else if !comments.data}
        <p class="mt-5 text-sm text-destructive" role="alert">{comments.error?.message ?? 'Could not load replies.'}</p>
        <Button class="mt-3" variant="outline" size="sm" onclick={() => comments.refetch()}>Try again</Button>
      {:else if comments.data.pages.every((page) => page.items.length === 0)}
        <p class="mt-5 text-sm text-muted-foreground">No replies yet. Start the conversation.</p>
      {:else}
        <ol class="mt-4 divide-y divide-border/80">
          {#each comments.data.pages as page}
            {#each page.items as comment (comment.id)}
              <li class="flex gap-3 py-4 first:pt-0 last:pb-0">
                <div class="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground" aria-hidden="true">
                  {comment.author.displayName[0]?.toUpperCase() ?? 'K'}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="mb-1.5 text-xs font-semibold">{comment.author.displayName}
                    <span class="ml-1 font-normal text-muted-foreground">@{comment.author.username} · <time datetime={comment.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(comment.createdAt))}</time></span>
                  </p>
                  <RichText content={comment.content} />
                  <MediaGallery media={comment.media} />
                </div>
              </li>
            {/each}
          {/each}
        </ol>
        {#if comments.isFetchNextPageError}
          <p class="mt-4 text-sm text-destructive" role="alert">{comments.error.message}</p>
          <Button class="mt-3 w-full" variant="outline" size="sm" onclick={() => comments.fetchNextPage()}>Try loading more replies</Button>
        {:else if comments.hasNextPage}
          <Button class="mt-4 w-full" variant="outline" size="sm" disabled={comments.isFetchingNextPage}
            onclick={() => comments.fetchNextPage()}>More replies</Button>
        {/if}
      {/if}
      <div class="mt-5 border-t border-border/80 pt-4">
        <Button variant="outline" size="sm" onclick={onReply}><MessageCircleIcon class="size-4" /> Write a reply</Button>
      </div>
    </section>
  {/if}
</article>

<style>
  .fluo-post { transition: border-color .2s ease, box-shadow .2s ease; }
  .fluo-post:hover { border-color: var(--input); box-shadow: 0 16px 40px -30px rgba(20, 65, 39, .55); }
  :global(.dislike-choice) {
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px) scale(.92);
    transition: opacity .18s ease, transform .18s ease;
  }
  .reaction-control:hover :global(.dislike-choice),
  .reaction-control:focus-within :global(.dislike-choice),
  .reaction-control.disliked :global(.dislike-choice) {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
  @media (hover: none) {
    .fluo-post [aria-label="Post actions"] { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .25rem; }
    .reaction-control { display: contents; }
    :global(.dislike-choice) {
      position: static;
      width: 100%;
      height: 2.75rem;
      border-color: transparent;
      background: transparent;
      box-shadow: none;
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }
    .reaction-control.disliked :global(.dislike-choice) { background: var(--secondary); }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.dislike-choice) { transition: none; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .comment-panel { animation: comment-in .22s ease-out both; }
  }
  @keyframes comment-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
