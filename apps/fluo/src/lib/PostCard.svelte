<script lang="ts">
	// Composes a post surface with its replies

	import type { Snippet } from 'svelte';
	import type { QueryClient } from '@tanstack/svelte-query';
	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import PostItem from './PostItem.svelte';
	import PostReplies from './PostReplies.svelte';

	let {
		post,
		viewerId,
		api,
		queryClient,
		repliesAlwaysVisible = false,
		focusTarget = false,
		threadContext,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onVisibilityChange,
		onDelete,
	}: {
		post: FluoPost;
		viewerId: string;
		api: FluoApi;
		queryClient: QueryClient;
		repliesAlwaysVisible?: boolean;
		focusTarget?: boolean;
		threadContext?: Snippet;
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

<PostItem
	{post}
	{viewerId}
	{focusTarget}
	{threadContext}
	showReplyAction={!repliesAlwaysVisible}
	{onReply}
	{onQuote}
	{onOpenPost}
	{onReact}
	{onFollow}
	{onSave}
	{onVisibilityChange}
	{onDelete}
>
	<PostReplies
		{post}
		{viewerId}
		{api}
		{queryClient}
		threadHasAncestors={threadContext !== undefined}
		{onReply}
		{onQuote}
		{onOpenPost}
		{onReact}
		{onFollow}
		{onSave}
		{onVisibilityChange}
		{onDelete}
		alwaysVisible={repliesAlwaysVisible}
	/>
</PostItem>
