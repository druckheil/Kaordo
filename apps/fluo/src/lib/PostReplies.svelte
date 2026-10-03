<script lang="ts">
	// Loads and renders paginated replies for a post

	import { createInfiniteQuery, type QueryClient } from "@tanstack/svelte-query";
	import { commentsOptions, type FluoApi } from "@kaordo/api-client";
	import type { FluoPost } from "@kaordo/contracts";
	import { Button, MessageCircleIcon, XIcon } from "@kaordo/ui";
	import { MediaGallery } from "@kaordo/media-ui";
	import RichText from "./RichText.svelte";

	let { post, api, queryClient, onReply }: {
		post: FluoPost;
		api: FluoApi;
		queryClient: QueryClient;
		onReply: () => void;
	} = $props();

	let expanded = $state(false);
	const replies = createInfiniteQuery(() => commentsOptions(api, post.id, expanded), () => queryClient);

	function formatReplyTime(value: string): string {
		return new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(value));
	}
</script>

{#if post.counts.comments > 0}
	<Button class="mt-2" variant="ghost" size="sm" aria-expanded={expanded}
		aria-controls={expanded ? `comments-${post.id}` : undefined} onclick={() => (expanded = !expanded)}>
		{expanded ? "Hide replies" : `View ${post.counts.comments} ${post.counts.comments === 1 ? "reply" : "replies"}`}
	</Button>
{/if}

{#if expanded}
	<section id={`comments-${post.id}`} class="comment-panel mt-4 border-t border-border/80 pt-4" aria-label="Replies">
		<div class="flex items-center justify-between gap-3">
			<h3 class="text-sm font-bold">
				Replies <span class="ml-1 font-medium text-muted-foreground">{post.counts.comments}</span>
			</h3>
			<Button variant="ghost" size="icon-xs" aria-label="Close replies" onclick={() => (expanded = false)}>
				<XIcon class="size-4" />
			</Button>
		</div>

		{#if replies.isPending}
			<p class="mt-5 text-sm text-muted-foreground" role="status">Loading replies…</p>
		{:else if !replies.data}
			<p class="mt-5 text-sm text-destructive" role="alert">{replies.error?.message ?? "Could not load replies."}</p>
			<Button class="mt-3" variant="outline" size="sm" onclick={() => void replies.refetch()}>Try again</Button>
		{:else if replies.data.pages.every((page) => page.items.length === 0)}
			<p class="mt-5 text-sm text-muted-foreground">No replies yet. Start the conversation.</p>
		{:else}
			<ol class="mt-4 grid gap-4">
				{#each replies.data.pages as page (page.nextCursor ?? "latest")}
					{#each page.items as reply (reply.id)}
						<li class="flex min-w-0 gap-3 rounded-xl border-l-2 border-border bg-background/65 px-3 py-3">
							<div class="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-xs font-bold text-secondary-foreground" aria-hidden="true">
								{reply.author.displayName[0]?.toLocaleUpperCase() ?? "K"}
							</div>
							<div class="min-w-0 flex-1">
								<div class="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
									<span class="font-semibold text-foreground">{reply.author.displayName}</span>
									<span class="text-muted-foreground">@{reply.author.username}</span>
									<time class="text-muted-foreground" datetime={reply.createdAt}>{formatReplyTime(reply.createdAt)}</time>
								</div>
								<RichText content={reply.content} />
								<MediaGallery media={reply.media} label="Reply media" />
							</div>
						</li>
					{/each}
				{/each}
			</ol>

			{#if replies.isFetchNextPageError}
				<p class="mt-4 text-sm text-destructive" role="alert">{replies.error.message}</p>
				<Button class="mt-3 w-full" variant="outline" size="sm" onclick={() => void replies.fetchNextPage()}>
					Try loading more replies
				</Button>
			{:else if replies.hasNextPage}
				<Button class="mt-4 w-full" variant="outline" size="sm" disabled={replies.isFetchingNextPage}
					onclick={() => void replies.fetchNextPage()}>
					{replies.isFetchingNextPage ? "Loading…" : "More replies"}
				</Button>
			{/if}
		{/if}

		<div class="mt-4">
			<Button variant="outline" size="sm" onclick={onReply}>
				<MessageCircleIcon class="size-4" /> Write a reply
			</Button>
		</div>
	</section>
{/if}

<style>
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
