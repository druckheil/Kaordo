<script lang="ts">
	// Renders the section heading and view-specific feed controls

	import { onDestroy } from "svelte";
	import type { Feed } from "@kaordo/api-client";
	import { BookmarkIcon, Button, Input, SearchIcon } from "@kaordo/ui";
	import type { FluoView } from "./fluo-model";
	import { fluoViews } from "./fluo-model";

	let {
		view,
		feed,
		searchTerm = $bindable(""),
		onFeedChange,
	}: {
		view: FluoView;
		feed: Feed;
		searchTerm?: string;
		onFeedChange: (feed: Feed) => void;
	} = $props();

	let searchInput = $state(searchTerm);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const details = $derived(fluoViews[view]);

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
		<p class="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-link">Fluo / {details.settingsSection ? 'Settings / ' : ''}{details.title}</p>
		<h1 class="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{details.title}</h1>
		<p class="mt-2 text-sm text-muted-foreground">{details.description}</p>
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
	<p class="mb-5 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
		<BookmarkIcon class="mr-2 inline size-4" />Only you can see the posts you save.
	</p>
{/if}
