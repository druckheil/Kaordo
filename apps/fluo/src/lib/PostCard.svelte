<script lang="ts">
	// Renders a post, its actions, and the reply list

	import type { QueryClient } from '@tanstack/svelte-query';
	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import { Button, Trash2Icon } from '@kaordo/ui';
	import { MediaGallery } from '@kaordo/media-ui';
	import PostActions from './PostActions.svelte';
	import PostReplies from './PostReplies.svelte';
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
	let following = $state(false);
	const date = $derived(formatPostTime(post.createdAt));
	const initials = $derived(authorInitials(post.author.displayName, post.author.username));

	function formatPostTime(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
	}

	function authorInitials(displayName: string, username: string): string {
		const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase();
		return initials || username[0]?.toLocaleUpperCase() || "K";
	}

	async function toggleFollow(): Promise<void> {
		if (following) return;
		following = true;
		try {
			await onFollow();
		} finally {
			following = false;
		}
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

  <PostActions {post} onReply={onReply} onQuote={onQuote} onReact={onReact} onSave={onSave} />

  <PostReplies {post} {api} {queryClient} onReply={onReply} />
</article>

<style>
  .fluo-post { transition: border-color .2s ease, box-shadow .2s ease; }
  .fluo-post:hover { border-color: var(--input); box-shadow: 0 16px 40px -30px rgba(20, 65, 39, .55); }
</style>
