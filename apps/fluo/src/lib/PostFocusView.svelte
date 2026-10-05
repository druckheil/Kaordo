<script lang="ts">
	// Presents a focused post in place of the feed

	import { tick } from 'svelte';
	import type { QueryClient } from '@tanstack/svelte-query';
	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import { Button } from '@kaordo/ui';
	import PostCard from './PostCard.svelte';
	import PostItem from './PostItem.svelte';

	let {
		thread,
		pending,
		error,
		viewerId,
		api,
		queryClient,
		onRetry,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onVisibilityChange,
		onDelete,
	}: {
		thread: FluoPost[];
		pending: boolean;
		error: string | null;
		viewerId: string;
		api: FluoApi;
		queryClient: QueryClient;
		onRetry: () => void;
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: (post: FluoPost, value: 'good' | 'bad' | null) => Promise<void>;
		onFollow: (post: FluoPost) => Promise<void>;
		onSave: (post: FluoPost) => Promise<void>;
		onVisibilityChange: (post: FluoPost, visibility: FluoPost['visibility']) => Promise<void>;
		onDelete: (post: FluoPost) => void;
	} = $props();

	const post = $derived(thread.at(-1));
	const ancestors = $derived(thread.slice(0, -1));
	const postId = $derived(post?.id);

	$effect(() => {
		const focusedPostId = postId;
		if (!focusedPostId) return;

		void tick().then(() => {
			if (post?.id !== focusedPostId) return;
			document.getElementById(`fluo-focused-post-${focusedPostId}`)?.scrollIntoView({
				block: 'start',
				behavior: 'instant',
			});
		});
	});
</script>

{#snippet threadContext()}
	{#if ancestors.length}
		<ol class="relative z-10 mb-4 grid gap-3 border-s-2 border-border ps-3" aria-label="Earlier posts in this thread">
			{#each ancestors as ancestor (ancestor.id)}
				<li class="min-w-0">
					<PostItem
						post={ancestor}
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
		</ol>
	{/if}
{/snippet}

{#if pending && !post}
	<p class="rounded-[1.5rem] border border-border bg-card p-6 text-sm text-muted-foreground" role="status">Loading post…</p>
{:else if !post && error}
	<div class="rounded-[1.5rem] border border-border bg-card p-6">
		<p class="text-sm text-destructive" role="alert">{error}</p>
		<Button class="mt-4" variant="outline" onclick={onRetry}>Try again</Button>
	</div>
{:else if post}
	<div>
		{#key post.id}
			<PostCard
				{post}
				{viewerId}
				{api}
				{queryClient}
				repliesAlwaysVisible
				focusTarget
				threadContext={ancestors.length ? threadContext : undefined}
				{onReply}
				{onQuote}
				{onOpenPost}
				{onReact}
				{onFollow}
				{onSave}
				{onVisibilityChange}
				{onDelete}
			/>
		{/key}
		<div class="h-[max(0px,calc(100dvh-10rem))] lg:h-[max(0px,calc(100dvh-6.5rem))]" aria-hidden="true"></div>
	</div>
{/if}
