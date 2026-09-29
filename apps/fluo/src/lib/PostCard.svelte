<script lang="ts">
  import { createInfiniteQuery, type QueryClient } from '@tanstack/svelte-query';
  import { commentsOptions, type FluoApi } from '@kaordo/api-client';
  import type { FluoPost } from '@kaordo/contracts';
  import { BookmarkIcon, Button, MessageCircleIcon, Repeat2Icon, ThumbsDownIcon, ThumbsUpIcon, Trash2Icon } from '@kaordo/ui';
  import MediaGallery from './MediaGallery.svelte';
  import RichText from './RichText.svelte';

  let { post, viewerId, api, queryClient, onReply, onQuote, onReact, onFollow, onSave, onDelete }: {
    post: FluoPost;
    viewerId: string;
    api: FluoApi;
    queryClient: QueryClient;
    onReply: () => void;
    onQuote: () => void;
    onReact: (value: 'good' | 'bad' | null) => void;
    onFollow: () => void;
    onSave: () => Promise<void>;
    onDelete: () => void;
  } = $props();
  let expanded = $state(false);
  let saving = $state(false);
  const comments = createInfiniteQuery(() => commentsOptions(api, post.id, expanded), () => queryClient);
  const date = $derived(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt)));

  async function toggleSaved() {
    if (saving) return;
    saving = true;
    try {
      await onSave();
    } finally {
      saving = false;
    }
  }
</script>

<article data-post-id={post.id} class="border-b px-4 py-5 last:border-b-0 sm:px-6" aria-label={`Post by ${post.author.username}`}>
  <header class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="truncate text-sm font-semibold">{post.author.displayName} <span class="font-normal text-muted-foreground">@{post.author.username}</span></p>
      <p class="mt-0.5 text-xs text-muted-foreground"><time datetime={post.createdAt}>{date}</time>{post.visibility === 'private' ? ' · Only me' : ''}</p>
    </div>
    {#if post.author.id !== viewerId && post.visibility === 'public'}
      <Button variant="outline" size="xs" onclick={onFollow}>{post.author.following ? 'Following' : 'Follow'}</Button>
    {:else if post.author.id === viewerId}
      <Button variant="ghost" size="icon-xs" aria-label="Delete post" title="Delete post" onclick={onDelete}><Trash2Icon class="size-3.5" /></Button>
    {/if}
  </header>

  <div class="mt-4"><RichText content={post.content} /></div>
  <MediaGallery media={post.media} />
  {#if post.quote}
    <div class="mt-4 rounded-xl border p-3 text-sm">
      <p class="font-medium">@{post.quote.author.username}</p>
      <p class="mt-1 line-clamp-4 whitespace-pre-wrap text-muted-foreground">{post.quote.text}</p>
    </div>
  {:else if post.quoteId}
    <p class="mt-4 rounded-xl border p-3 text-xs text-muted-foreground">Quoted post unavailable.</p>
  {/if}

  <div class="mt-5 flex flex-wrap items-center gap-2" aria-label="Post actions">
    <Button variant={post.myReaction === 'good' ? 'secondary' : 'ghost'} size="sm" aria-label={`Good, ${post.counts.good}`} aria-pressed={post.myReaction === 'good'} onclick={() => onReact('good')}><ThumbsUpIcon class="size-4" /> {post.counts.good}</Button>
    <Button variant={post.myReaction === 'bad' ? 'secondary' : 'ghost'} size="sm" aria-label={`Bad, ${post.counts.bad}`} aria-pressed={post.myReaction === 'bad'} onclick={() => onReact('bad')}><ThumbsDownIcon class="size-4" /> {post.counts.bad}</Button>
    <Button variant="ghost" size="sm" aria-expanded={expanded} onclick={() => expanded = !expanded}><MessageCircleIcon class="size-4" /> {post.counts.comments}</Button>
    <Button variant="ghost" size="sm" onclick={onReply}>Reply</Button>
    {#if post.visibility === 'public'}<Button variant="ghost" size="sm" onclick={onQuote}><Repeat2Icon class="size-4" /> Quote</Button>{/if}
    <Button variant={post.saved ? 'secondary' : 'ghost'} size="sm" aria-label={post.saved ? 'Remove from saved posts' : 'Save post'} aria-pressed={post.saved} disabled={saving} onclick={toggleSaved}><BookmarkIcon class={post.saved ? 'size-4 fill-current' : 'size-4'} /> {post.saved ? 'Saved' : 'Save'}</Button>
  </div>

  {#if expanded}
    <section class="mt-4 border-t pt-4" aria-label="Comments">
      {#if comments.isPending}
        <p class="text-sm text-muted-foreground" role="status">Loading comments…</p>
      {:else if comments.isError}
        <p class="text-sm text-destructive" role="alert">{comments.error.message}</p>
      {:else if comments.data.pages.every((page) => page.items.length === 0)}
        <p class="text-sm text-muted-foreground">No comments yet.</p>
      {:else}
        {#each comments.data.pages as page}
          {#each page.items as comment (comment.id)}
            <div class="border-b py-4 last:border-b-0">
              <p class="mb-2 text-xs font-medium">@{comment.author.username} <span class="font-normal text-muted-foreground">· {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(comment.createdAt))}</span></p>
              <RichText content={comment.content} />
              <MediaGallery media={comment.media} />
            </div>
          {/each}
        {/each}
        {#if comments.hasNextPage}
          <Button class="mt-3" variant="outline" size="sm" disabled={comments.isFetchingNextPage} onclick={() => comments.fetchNextPage()}>More comments</Button>
        {/if}
      {/if}
    </section>
  {/if}
</article>
