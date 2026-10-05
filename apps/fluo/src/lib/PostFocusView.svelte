<script lang="ts">
	// Presents a focused post in place of the feed

	import type { QueryClient } from '@tanstack/svelte-query';
	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import { Button, ChevronLeftIcon } from '@kaordo/ui';
	import PostCard from './PostCard.svelte';

	let {
		post,
		pending,
		error,
		viewerId,
		api,
		queryClient,
		onBack,
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
		post: FluoPost | undefined;
		pending: boolean;
		error: string | null;
		viewerId: string;
		api: FluoApi;
		queryClient: QueryClient;
		onBack: () => void;
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
</script>

<div class="grid gap-3">
	<Button class="w-fit" variant="ghost" size="sm" onclick={onBack}>
		<ChevronLeftIcon class="size-4" /> Back
	</Button>

	{#if pending && !post}
		<p class="rounded-[1.5rem] border border-border bg-card p-6 text-sm text-muted-foreground" role="status">Loading post…</p>
	{:else if !post && error}
		<div class="rounded-[1.5rem] border border-border bg-card p-6">
			<p class="text-sm text-destructive" role="alert">{error}</p>
			<Button class="mt-4" variant="outline" onclick={onRetry}>Try again</Button>
		</div>
	{:else if post}
		{#key post.id}
			<PostCard
				{post}
				{viewerId}
				{api}
				{queryClient}
				repliesAlwaysVisible
				onReply={() => onReply(post)}
				onQuote={() => onQuote(post)}
				{onOpenPost}
				onReact={(value) => onReact(post, value)}
				onFollow={() => onFollow(post)}
				onSave={() => onSave(post)}
				onVisibilityChange={(visibility) => onVisibilityChange(post, visibility)}
				onDelete={() => onDelete(post)}
			/>
		{/key}
	{/if}
</div>
