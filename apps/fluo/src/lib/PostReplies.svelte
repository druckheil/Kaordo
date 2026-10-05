<script lang="ts">
	// Loads paginated replies and renders them as interactive posts

	import { createInfiniteQuery, type QueryClient } from '@tanstack/svelte-query';
	import { commentsOptions, type FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import { Button, MessageCircleIcon, XIcon } from '@kaordo/ui';
	import PostItem from './PostItem.svelte';

	let {
		post,
		viewerId,
		api,
		queryClient,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onVisibilityChange,
		onDelete,
		alwaysVisible = false,
		threadHasAncestors = false,
	}: {
		post: FluoPost;
		viewerId: string;
		api: FluoApi;
		queryClient: QueryClient;
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: (post: FluoPost, value: 'good' | 'bad' | null) => Promise<void>;
		onFollow: (post: FluoPost) => Promise<void>;
		onSave: (post: FluoPost) => Promise<void>;
		onVisibilityChange: (post: FluoPost, visibility: FluoPost['visibility']) => Promise<void>;
		onDelete: (post: FluoPost) => void;
		alwaysVisible?: boolean;
		threadHasAncestors?: boolean;
	} = $props();

	let expanded = $state(false);
	let nextPageRequest = false;
	const repliesVisible = $derived(alwaysVisible || expanded);
	const replies = createInfiniteQuery(() => commentsOptions(api, post.id, repliesVisible), () => queryClient);

	async function fetchNextReplies(retry = false): Promise<void> {
		if (nextPageRequest || !replies.hasNextPage || replies.isFetchingNextPage) return;
		if (!retry && replies.isFetchNextPageError) return;

		nextPageRequest = true;
		try {
			await replies.fetchNextPage();
		} catch {
			// The query state renders the retry message below.
		} finally {
			nextPageRequest = false;
		}
	}

	function observeReplyEnd(node: HTMLDivElement) {
		const observer = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting) void fetchNextReplies();
		}, { rootMargin: '320px 0px' });
		observer.observe(node);

		return { destroy: () => observer.disconnect() };
	}
</script>

{#if !alwaysVisible && post.counts.comments > 0}
	<Button class="relative z-10 mt-2" variant="ghost" size="sm" aria-expanded={expanded}
		aria-controls={expanded ? `comments-${post.id}` : undefined} onclick={() => (expanded = !expanded)}>
		{expanded ? 'Hide replies' : `View ${post.counts.comments} ${post.counts.comments === 1 ? 'reply' : 'replies'}`}
	</Button>
{/if}

{#if repliesVisible}
	<section id={`comments-${post.id}`} class="comment-panel relative z-10 mt-4 border-t border-border/80 pt-4" aria-label="Replies">
		<div class="flex items-center justify-between gap-3">
			<h3 class="text-sm font-bold">
				Replies <span class="ml-1 font-medium text-muted-foreground">{post.counts.comments}</span>
			</h3>
			{#if !alwaysVisible}
				<Button variant="ghost" size="icon-xs" aria-label="Close replies" onclick={() => (expanded = false)}>
					<XIcon class="size-4" />
				</Button>
			{/if}
		</div>

		{#if alwaysVisible}
			<Button class="mt-4 w-full justify-center" variant="outline" size="sm" onclick={() => onReply(post)}>
				<MessageCircleIcon class="size-4" /> Write a reply
			</Button>
		{/if}

		{#if replies.isPending}
			<p class="mt-5 text-sm text-muted-foreground" role="status">Loading replies…</p>
		{:else if !replies.data}
			<p class="mt-5 text-sm text-destructive" role="alert">{replies.error?.message ?? 'Could not load replies.'}</p>
			<Button class="mt-3" variant="outline" size="sm" onclick={() => void replies.refetch()}>Try again</Button>
		{:else if replies.data.pages.every((page) => page.items.length === 0)}
			<p class="mt-5 text-sm text-muted-foreground">No replies yet. Start the conversation.</p>
		{:else}
			<ol class="reply-list mt-4 grid gap-4 border-s-2 border-border ps-3" class:reply-list-threaded={threadHasAncestors}>
				{#each replies.data.pages as page (page.nextCursor ?? 'latest')}
					{#each page.items as reply (reply.id)}
						<li class="min-w-0">
							<PostItem
								post={reply}
								{viewerId}
								compact
								{onReply}
								{onQuote}
								{onOpenPost}
								{onReact}
								{onFollow}
								{onSave}
								{onVisibilityChange}
								{onDelete}
							/>
						</li>
					{/each}
				{/each}
			</ol>

			{#if replies.isFetchNextPageError}
				<p class="mt-4 text-sm text-destructive" role="alert">{replies.error.message}</p>
				<Button class="mt-3" variant="outline" size="sm" onclick={() => void fetchNextReplies(true)}>
					Retry loading replies
				</Button>
			{:else if replies.hasNextPage}
				{#if replies.isFetchingNextPage}
					<p class="mt-4 text-center text-sm text-muted-foreground" role="status">Loading more replies…</p>
				{/if}
				<div class="h-px" aria-hidden="true" use:observeReplyEnd></div>
			{/if}
		{/if}

		{#if !alwaysVisible}
			<div class="mt-4">
				<Button variant="outline" size="sm" onclick={() => onReply(post)}>
					<MessageCircleIcon class="size-4" /> Write a reply
				</Button>
			</div>
		{/if}
	</section>
{/if}

<style>
	.reply-list-threaded {
		position: relative;
	}

	.reply-list-threaded::before {
		position: absolute;
		inset-block: 0;
		inset-inline-start: -0.5rem;
		inline-size: 2px;
		background-color: var(--border);
		content: '';
	}

	@media (prefers-reduced-motion: no-preference) {
		.comment-panel {
			animation: comment-in 0.22s ease-out both;
		}
	}

	@keyframes comment-in {
		from { opacity: 0; transform: translateY(-6px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
