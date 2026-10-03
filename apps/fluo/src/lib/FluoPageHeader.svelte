<script lang="ts">
	// Renders the section heading and view-specific feed controls

	import { onDestroy } from "svelte";
	import type { Feed } from "@kaordo/api-client";
	import type { UserIdentity } from "@kaordo/contracts";
	import { BookmarkIcon, Button, Input, SearchIcon } from "@kaordo/ui";
	import type { FluoView } from "./fluo-model";
	import { descriptionForView, displayInitial, titleForView } from "./fluo-model";

	let {
		view,
		feed,
		user,
		searchTerm = $bindable(""),
		onFeedChange,
	}: {
		view: FluoView;
		feed: Feed;
		user: UserIdentity;
		searchTerm?: string;
		onFeedChange: (feed: Feed) => void;
	} = $props();

	let searchInput = $state(searchTerm);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const pageTitle = $derived(titleForView(view));
	const pageDescription = $derived(descriptionForView(view));

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
	});

	function changeSearch(event: Event): void {
		searchInput = (event.currentTarget as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);

		searchTimer = setTimeout(() => {
			if (view !== "search") return;
			searchTerm = searchInput.trim();
			window.scrollTo({ top: 0 });
		}, 250);
	}
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<div>
		<p class="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Fluo / {pageTitle}</p>
		<h1 class="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{pageTitle}</h1>
		<p class="mt-2 text-sm text-muted-foreground">{pageDescription}</p>
	</div>
	{#if view === "feed"}
		<div class="flex rounded-xl border border-border bg-card p-1" role="group" aria-label="Feed order">
			{#each ["latest", "following"] as tab}
				{@const selectedFeed = tab as Feed}
				<Button
					variant={feed === selectedFeed ? "secondary" : "ghost"}
					size="sm"
					aria-pressed={feed === selectedFeed}
					onclick={() => {
						onFeedChange(selectedFeed);
						window.scrollTo({ top: 0 });
					}}
				>
					{selectedFeed === "latest" ? "Latest" : "Following"}
				</Button>
			{/each}
		</div>
	{/if}
</div>

{#if view === "search"}
	<div class="mb-6 rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
		<label class="sr-only" for="fluo-search">Search posts</label>
		<div class="relative">
			<SearchIcon class="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
			<Input
				id="fluo-search"
				class="pl-11"
				type="search"
				placeholder="Search posts"
				value={searchInput}
				oninput={changeSearch}
			/>
		</div>
		<p class="mt-3 text-xs text-muted-foreground">Search public posts and your own posts by text or author.</p>
	</div>
{:else if view === "saved"}
	<p class="mb-5 rounded-xl border border-border bg-accent/60 px-4 py-3 text-sm text-accent-foreground">
		<BookmarkIcon class="mr-2 inline size-4" />Only you can see the posts you save.
	</p>
{:else if view === "profile"}
	<div class="mb-6 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
		<div class="h-20 bg-gradient-to-r from-secondary via-accent to-muted"></div>
		<div class="-mt-6 flex items-end gap-4 px-5 pb-5">
			<div class="grid size-14 shrink-0 place-items-center rounded-2xl border-4 border-card bg-primary text-xl font-bold text-primary-foreground" aria-hidden="true">
				{displayInitial(user.displayName)}
			</div>
			<div class="min-w-0 pb-0.5">
				<h2 class="truncate text-lg font-bold">{user.displayName}</h2>
				<p class="text-sm text-muted-foreground">@{user.username}</p>
			</div>
		</div>
	</div>
{/if}
