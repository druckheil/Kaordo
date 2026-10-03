<script lang="ts">
	// Loads and presents a post in its navigable detail dialog

	import type { QueryClient } from "@tanstack/svelte-query";
	import type { FluoApi } from "@kaordo/api-client";
	import type { FluoPost, UserIdentity } from "@kaordo/contracts";
	import { Button, ChevronLeftIcon, Dialog } from "@kaordo/ui";
	import { maxMediaHeightRem, mediaFrameRatio } from "@kaordo/media-ui";
	import PostCard from "./PostCard.svelte";

	let {
		api,
		user,
		queryClient,
		open,
		post,
		pending,
		error,
		onOpenChange,
		onClose,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onDelete,
	}: {
		api: FluoApi;
		user: UserIdentity;
		queryClient: QueryClient;
		open: boolean;
		post: FluoPost | undefined;
		pending: boolean;
		error: string | null;
		onOpenChange: (open: boolean) => void;
		onClose: () => void;
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: (post: FluoPost, value: "good" | "bad" | null) => Promise<void>;
		onFollow: (post: FluoPost) => Promise<void>;
		onSave: (post: FluoPost) => Promise<void>;
		onDelete: (post: FluoPost) => void;
	} = $props();

	const detailReady = $derived(open && (!!post || !!error));
	const dialogWidth = $derived(postDialogWidth(post));
	let showLoading = $state(false);

	$effect(() => {
		if (!open || detailReady) {
			showLoading = false;
			return;
		}
		const timer = setTimeout(() => (showLoading = true), 180);
		return () => clearTimeout(timer);
	});

	function postDialogWidth(post: FluoPost | undefined): string {
		const onlyMedia = post?.media.length === 1 ? post.media[0] : null;
		if (!onlyMedia) return "min(60rem, calc(100vw - 2rem))";

		const frameWidth = maxMediaHeightRem * mediaFrameRatio(onlyMedia);
		return `min(${Math.min(60, Math.max(28, frameWidth + 7))}rem, calc(100vw - 2rem))`;
	}

	function dismissPendingPost(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.key !== "Escape" || !open || detailReady) return;
		event.preventDefault();
		onClose();
	}
</script>

<svelte:window onkeydowncapture={dismissPendingPost} />

{#if showLoading}
	<div class="fixed left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-border bg-card py-2 pl-4 pr-2 text-sm font-medium shadow-lg">
		<span class="size-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true"></span>
		<span role="status" aria-live="polite">Opening post…</span>
		<Button variant="ghost" size="xs" onclick={onClose}>Cancel</Button>
	</div>
{/if}

<Dialog.Root open={detailReady} onOpenChange={onOpenChange}>
	<Dialog.Content class="grid-cols-[minmax(0,1fr)] min-w-0 overflow-hidden p-2" style={`max-width: ${dialogWidth}`}>
		<div class="post-detail-scroll kaordo-scrollbar grid min-w-0 max-h-[calc(90dvh-1rem)] grid-cols-[minmax(0,1fr)] gap-6 overflow-x-hidden overflow-y-auto p-1 sm:p-3">
			<Dialog.Header class="pr-10">
				<Dialog.Title class="text-lg font-bold">Post</Dialog.Title>
				<Dialog.Description class="sr-only">Read the quoted post, then go back to your place in the feed.</Dialog.Description>
			</Dialog.Header>
			<div class="min-w-0">
				<Button variant="ghost" size="sm" class="mb-3" onclick={onClose}>
					<ChevronLeftIcon class="size-4" /> Back
				</Button>
				{#if pending}
					<p role="status" class="rounded-xl bg-muted p-6 text-sm text-muted-foreground">Loading post…</p>
				{:else if error}
					<p role="alert" class="rounded-xl bg-muted p-6 text-sm text-destructive">{error}</p>
				{:else if post}
					<PostCard
						{post}
						viewerId={user.id}
						{api}
						{queryClient}
						onReply={() => onReply(post)}
						onQuote={() => onQuote(post)}
						onOpenPost={onOpenPost}
						onReact={(value) => onReact(post, value)}
						onFollow={() => onFollow(post)}
						onSave={() => onSave(post)}
						onDelete={() => onDelete(post)}
					/>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
