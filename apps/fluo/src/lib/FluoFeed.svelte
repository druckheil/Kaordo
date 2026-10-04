<script lang="ts">
	// Loads, virtualizes, and renders the active post feed

	import { untrack } from "svelte";
	import { createInfiniteQuery, type QueryClient } from "@tanstack/svelte-query";
	import { createWindowVirtualizer } from "@tanstack/svelte-virtual";
	import { feedOptions, type Feed, type FluoApi } from "@kaordo/api-client";
	import type { FluoPage, FluoPost, UserIdentity } from "@kaordo/contracts";
	import { BookmarkIcon, Button } from "@kaordo/ui";
	import { estimatePostHeight, feedEmptyDescription, feedEmptyTitle, feedForView, type FluoView } from "./fluo-model";
	import PostCard from "./PostCard.svelte";

	let {
		view,
		feed,
		searchTerm,
		user,
		api,
		queryClient,
		removedIds,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onDelete,
	}: {
		view: FluoView;
		feed: Feed;
		searchTerm: string;
		user: UserIdentity;
		api: FluoApi;
		queryClient: QueryClient;
		removedIds: string[];
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: (post: FluoPost, reaction: "good" | "bad" | null) => Promise<void>;
		onFollow: (post: FluoPost) => Promise<void>;
		onSave: (post: FluoPost) => Promise<void>;
		onDelete: (post: FluoPost) => void;
	} = $props();

	const canQueryPosts = $derived(view === "feed" || view === "search" || view === "saved" || view === "profile");
	const currentFeed = $derived(feedForView(view, feed));
	const activeSearch = $derived(view === "search" ? searchTerm : undefined);
	const query = createInfiniteQuery(() => ({
		...feedOptions(api, currentFeed, activeSearch),
		enabled: typeof window !== "undefined" && canQueryPosts && (view !== "search" || searchTerm.length >= 2),
	}), () => queryClient);
	const posts = $derived(
		query.data?.pages.flatMap((page) => page.items).filter((post) => !removedIds.includes(post.id)) ?? [],
	);
	let listElement = $state<HTMLDivElement>();

	const virtualizer = createWindowVirtualizer<HTMLDivElement>({
		count: 0,
		getItemKey: (index) => posts[index]?.id ?? index,
		estimateSize: (index) => estimatePostHeight(
			posts[index],
			contentWidth(),
			viewportWidth(),
			rootFontSize(),
		),
		overscan: 4,
	});

	$effect(() => {
		const postIds = canQueryPosts ? posts.map((post) => post.id) : [];
		untrack(() => {
			$virtualizer.setOptions({
				count: postIds.length,
				getItemKey: (index) => postIds[index] ?? index,
			});
		});
	});

	$effect(() => {
		const lastRow = $virtualizer.getVirtualItems().at(-1);
		if (!canQueryPosts || !lastRow || lastRow.index < posts.length - 3) return;
		if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
	});

	function viewportWidth(): number {
		return typeof window === "undefined" ? 1024 : window.innerWidth;
	}

	function contentWidth(): number {
		const viewport = viewportWidth();
		const columnWidth = listElement?.clientWidth ?? Math.min(736, viewport - (viewport >= 640 ? 48 : 32));
		return Math.max(1, columnWidth - (viewport >= 640 ? 50 : 34));
	}

	function rootFontSize(): number {
		if (typeof window === "undefined") return 16;
		return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	}

	function trackList(node: HTMLDivElement) {
		listElement = node;
		let previousMargin = -1;

		const updateScrollMargin = () => {
			const nextMargin = Math.round(node.getBoundingClientRect().top + window.scrollY);
			if (nextMargin === previousMargin) return;
			previousMargin = nextMargin;
			$virtualizer.setOptions({ scrollMargin: nextMargin });
		};

		const observer = new ResizeObserver(updateScrollMargin);
		observer.observe(node.parentElement ?? node);
		window.addEventListener("resize", updateScrollMargin);
		const frame = requestAnimationFrame(updateScrollMargin);

		return {
			destroy() {
				cancelAnimationFrame(frame);
				observer.disconnect();
				window.removeEventListener("resize", updateScrollMargin);
				if (listElement === node) listElement = undefined;
			},
		};
	}

	function measurePost(node: HTMLDivElement): void {
		$virtualizer.measureElement(node);
	}
</script>

{#if view === "search" && searchTerm.length < 2}
	<p class="rounded-[1.5rem] border border-dashed border-border bg-card/60 py-14 text-center text-sm text-muted-foreground" role="status">
		Enter at least two characters to search.
	</p>
{:else if query.isPending}
	<div role="status" aria-label="Loading posts" class="space-y-4">
		{#each [1, 2] as placeholder (placeholder)}
			<div class="h-64 animate-pulse rounded-[1.5rem] border border-border bg-card p-6" aria-hidden="true">
				<div class="size-10 rounded-xl bg-muted"></div>
				<div class="mt-6 h-4 w-3/4 rounded bg-muted"></div>
				<div class="mt-3 h-4 w-1/2 rounded bg-muted"></div>
			</div>
		{/each}
		<span class="sr-only">Loading posts…</span>
	</div>
{:else if query.isError && !query.data}
	<div class="rounded-[1.5rem] border border-border bg-card px-6 py-14 text-center">
		<p class="text-destructive" role="alert">{query.error.message}</p>
		<Button class="mt-4" variant="outline" onclick={() => void query.refetch()}>Try again</Button>
	</div>
{:else if posts.length === 0}
	<div class="rounded-[1.5rem] border border-border bg-card px-6 py-16 text-center shadow-sm">
		<div class="mx-auto grid size-14 place-items-center rounded-2xl bg-accent">
			<BookmarkIcon class="size-6 text-accent-foreground" />
		</div>
		<p class="mt-5 text-xl font-bold tracking-tight">{feedEmptyTitle(view, feed)}</p>
		<p class="mt-2 text-sm text-muted-foreground">{feedEmptyDescription(view, feed)}</p>
	</div>
{:else}
	<div
		use:trackList
		class="relative w-full"
		style:height={$virtualizer.getTotalSize() + "px"}
		aria-label={view === "saved" ? "Saved posts" : view === "profile" ? "Profile posts" : view === "search" ? "Search results" : "Posts"}
	>
		{#each $virtualizer.getVirtualItems().filter((row) => row.index < posts.length) as row (posts[row.index].id)}
			{@const post = posts[row.index]}
			<div
				data-index={row.index}
				class="absolute left-0 top-0 w-full pb-4"
				style:transform={`translateY(${row.start - $virtualizer.options.scrollMargin}px)`}
				use:measurePost
			>
				<PostCard
					{post}
					viewerId={user.id}
					{api}
					{queryClient}
					onReply={() => onReply(post)}
					onQuote={() => onQuote(post)}
					onOpenPost={onOpenPost}
					onReact={(reaction) => onReact(post, reaction)}
					onFollow={() => onFollow(post)}
					onSave={() => onSave(post)}
					onDelete={() => onDelete(post)}
				/>
			</div>
		{/each}
	</div>

	{#if query.isFetchingNextPage}
		<p class="mt-3 text-center text-sm text-muted-foreground" role="status">Loading more…</p>
	{/if}
	{#if query.isFetchNextPageError}
		<Button class="mt-3 w-full" variant="outline" onclick={() => void query.fetchNextPage()}>
			Try loading more
		</Button>
	{/if}
{/if}
