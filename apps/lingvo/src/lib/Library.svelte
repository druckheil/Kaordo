<script lang="ts">
	// Imports original German starter sets and individual cards into the active private dictionary
	import { onDestroy } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { lingvoCatalogOptions } from '@kaordo/api-client';
	import type { LingvoCatalogSet, LingvoDictionary, LingvoFolder } from '@kaordo/contracts';
	import {
		BookOpenIcon,
		Button,
		CheckIcon,
		Dialog,
		LayersIcon,
		LoaderCircleIcon,
		MessageCircleIcon,
		PlusIcon,
		ToggleGroup
	} from '@kaordo/ui';
	import { errorMessage, getLingvoContext, type CardKind } from './lingvo-context';
	import CardDefinition from './CardDefinition.svelte';
	import FolderPicker from './FolderPicker.svelte';

	let {
		dictionary,
		folders,
		onStudy
	}: { dictionary: LingvoDictionary; folders: LingvoFolder[]; onStudy(kind: CardKind): void } =
		$props();
	const { api, queryClient, changed, notify } = getLingvoContext();
	const catalog = createQuery(
		() => lingvoCatalogOptions(api, dictionary.nativeLanguage),
		() => queryClient
	);
	let filter = $state('all');
	let selected = $state<LingvoCatalogSet | null>(null);
	let keys = $state<string[]>([]);
	let folder = $state('');
	let busy = $state('');
	let error = $state('');
	let disposed = false;
	const abort = new AbortController();
	const sets = $derived(
		(catalog.data?.items ?? []).filter((set) => filter === 'all' || set.kind === filter)
	);
	onDestroy(() => {
		disposed = true;
		abort.abort();
	});

	function openSet(set: LingvoCatalogSet): void {
		selected = set;
		keys = set.cards.map((card) => card.id);
		error = '';
	}

	async function add(
		set: LingvoCatalogSet,
		status: 'active' | 'known',
		cardKeys?: string[]
	): Promise<void> {
		if (busy || cardKeys?.length === 0) return;
		busy = set.id;
		error = '';
		try {
			const result = await api.importCards(
				dictionary.id,
				{ setId: set.id, cardKeys, folderId: folder || null, status },
				abort.signal
			);
			if (disposed) return;
			void changed(dictionary.id);
			notify(
				result.added +
					(result.added === 1 ? ' card added.' : ' cards added.') +
					(result.skipped ? ' ' + result.skipped + ' already in your dictionary.' : '')
			);
			selected = null;
		} catch (cause) {
			if (!disposed) error = errorMessage(cause);
		} finally {
			if (!disposed) busy = '';
		}
	}
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<div>
		<p class="lingvo-eyebrow">Start with something useful</p>
		<h1 class="mt-2 text-3xl font-bold tracking-tight">A little library of German</h1>
		<p class="mt-2 text-sm text-muted-foreground">
			Original starter sets. Keep what matters to you and add your own along the way.
		</p>
	</div>
	<ToggleGroup.Root
		type="single"
		value={filter}
		onValueChange={(value) => {
			if (value) filter = value;
		}}
		variant="outline"
		aria-label="Library card type"
	>
		<ToggleGroup.Item value="all">All sets</ToggleGroup.Item><ToggleGroup.Item value="word"
			>Words</ToggleGroup.Item
		><ToggleGroup.Item value="phrase">Phrases</ToggleGroup.Item>
	</ToggleGroup.Root>
</div>

{#if catalog.isError}
	<div class="lingvo-surface p-6">
		<p role="alert" class="text-sm text-destructive">{errorMessage(catalog.error)}</p>
		<Button class="mt-4" variant="outline" onclick={() => void catalog.refetch()}>Try again</Button>
	</div>
{:else if catalog.isPending}
	<p class="py-20 text-center text-muted-foreground" role="status">Finding your first words…</p>
{:else}
	{#if error && !selected}<p class="mb-4 text-sm text-destructive" role="alert">{error}</p>{/if}
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each sets as set (set.id)}
			<article
				class="lingvo-surface set-card group flex flex-col overflow-hidden transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none"
			>
				<button
					class="set-cover relative flex min-h-40 w-full flex-col items-start justify-between p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
					onclick={() => openSet(set)}
					aria-label={'Preview ' + set.title}
				>
					<div class="flex w-full items-center justify-between">
						<span class="rounded-lg bg-card/80 px-2.5 py-1 text-xs font-semibold">{set.level}</span
						><span class="rounded-lg bg-card/80 p-2"
							>{#if set.kind === 'word'}<BookOpenIcon class="size-5" />{:else}<MessageCircleIcon
									class="size-5"
								/>{/if}</span
						>
					</div>
					<p lang="de" class="max-w-full truncate pt-5 text-2xl font-bold tracking-tight">
						{set.cards[0].article ? set.cards[0].article + ' ' : ''}{set.cards[0].term}
					</p>
					<span class="absolute -right-3 -bottom-5 text-8xl font-bold opacity-10" aria-hidden="true"
						>{set.kind === 'word' ? 'Aa' : '„'}</span
					>
				</button>
				<div class="flex flex-1 flex-col p-5">
					<p class="lingvo-eyebrow">
						{set.cards.length}
						{set.kind}{set.cards.length === 1 ? '' : 's'}
					</p>
					<h2 class="mt-2 text-lg font-bold">{set.title}</h2>
					<p class="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{set.description}</p>
					<div class="mt-5 flex gap-2">
						<Button class="flex-1" variant="outline" size="sm" onclick={() => openSet(set)}
							>Explore</Button
						><Button
							size="sm"
							disabled={!!busy}
							aria-label={'Add ' + set.title}
							onclick={() => void add(set, 'active')}
							>{#if busy === set.id}<LoaderCircleIcon
									class="size-4 motion-safe:animate-spin"
								/>{:else}<PlusIcon class="size-4" />{/if}Add</Button
						>
					</div>
				</div>
			</article>
		{/each}
	</div>
	<div
		class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-muted/25 p-5"
	>
		<div class="flex items-center gap-3">
			<LayersIcon class="size-5 text-muted-foreground" />
			<p class="text-sm text-muted-foreground">
				Your dictionary is yours. Edit cards, organise folders or import a CSV.
			</p>
		</div>
		<Button variant="ghost" onclick={() => onStudy(filter === 'phrase' ? 'phrase' : 'word')}
			>Open practice</Button
		>
	</div>
{/if}

<Dialog.Root
	open={!!selected}
	onOpenChange={(value) => {
		if (!value) selected = null;
	}}
>
	<Dialog.Content class="flex max-h-[90dvh] flex-col gap-4 sm:max-w-2xl">
		{#if selected}
			<Dialog.Header
				><Dialog.Title>{selected.title}</Dialog.Title><Dialog.Description
					>{selected.description} Select the cards you want to keep.</Dialog.Description
				></Dialog.Header
			>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<FolderPicker {folders} bind:value={folder} /><Button
					variant="ghost"
					size="xs"
					onclick={() => {
						keys =
							keys.length === selected?.cards.length
								? []
								: (selected?.cards.map((card) => card.id) ?? []);
					}}>{keys.length === selected.cards.length ? 'Clear selection' : 'Select all'}</Button
				>
			</div>
			<ToggleGroup.Root
				type="multiple"
				bind:value={keys}
				spacing={2}
				orientation="vertical"
				aria-label="Cards to add"
				class="min-h-0 w-full flex-1 overflow-y-auto rounded-2xl border border-border p-2"
			>
				{#each selected.cards as card (card.id)}
					<ToggleGroup.Item
						value={card.id}
						class="h-auto w-full justify-start gap-4 rounded-xl border border-transparent px-4 py-4 text-left whitespace-normal data-[state=on]:border-primary/20 data-[state=on]:bg-primary/5"
					>
						<span class="grid size-6 shrink-0 place-items-center rounded-full border border-border"
							>{#if keys.includes(card.id)}<CheckIcon class="size-3.5 text-link" />{/if}</span
						>
						<div class="min-w-0 flex-1 font-normal">
							<CardDefinition {card} compact nativeLanguage={dictionary.nativeLanguage} />
						</div>
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			<Dialog.Footer class="flex-wrap gap-2">
				<Button
					variant="outline"
					disabled={!!busy || !keys.length}
					onclick={() => {
						if (selected) void add(selected, 'known', keys);
					}}>Already know these</Button
				>
				<Button
					disabled={!!busy || !keys.length}
					onclick={() => {
						if (selected) void add(selected, 'active', keys);
					}}
					>{#if busy}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{:else}<PlusIcon
							class="size-4"
						/>{/if}Learn {keys.length}
					{keys.length === 1 ? 'card' : 'cards'}</Button
				>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	.set-cover {
		background: color-mix(in oklch, var(--accent), var(--card) 30%);
	}
	.set-card:nth-child(4n + 2) .set-cover {
		background: light-dark(#f5eadd, #322d26);
	}
	.set-card:nth-child(4n + 3) .set-cover {
		background: light-dark(#e3edef, #233337);
	}
	.set-card:nth-child(4n + 4) .set-cover {
		background: light-dark(#ede6f3, #302839);
	}
</style>
