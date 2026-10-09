<script lang="ts">
	// Previews bounded CSV imports and exports complete dictionary content without learning history
	import { onDestroy } from 'svelte';
	import type { LingvoCardContent, LingvoDictionary, LingvoFolder } from '@kaordo/contracts';
	import { cardContent, emptyCard } from '@kaordo/lingvo-client';
	import {
		Button,
		Dialog,
		DownloadIcon,
		Input,
		LoaderCircleIcon,
		ToggleGroup,
		UploadIcon
	} from '@kaordo/ui';
	import { errorMessage, getLingvoContext } from './lingvo-context';
	import FolderPicker from './FolderPicker.svelte';

	let {
		dictionary,
		folders,
		onClose
	}: { dictionary: LingvoDictionary; folders: LingvoFolder[]; onClose(): void } = $props();
	const { api, changed, notify } = getLingvoContext();
	const id = $props.id();
	let mode = $state('import');
	let folder = $state('');
	let rows = $state<LingvoCardContent[]>([]);
	let filename = $state('');
	let busy = $state(false);
	let error = $state('');
	let progress = $state('');
	let readVersion = 0;
	let disposed = false;
	const abort = new AbortController();
	onDestroy(() => {
		disposed = true;
		readVersion += 1;
		abort.abort();
	});

	async function selectFile(event: Event): Promise<void> {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		const version = ++readVersion;
		rows = [];
		filename = file?.name ?? '';
		error = '';
		if (!file) return;
		busy = true;
		try {
			const { importCSV } = await import('@kaordo/lingvo-client/csv');
			const parsed = await importCSV(file, null);
			if (!disposed && version === readVersion) rows = parsed;
		} catch (cause) {
			if (!disposed && version === readVersion) error = errorMessage(cause);
		} finally {
			if (!disposed && version === readVersion) busy = false;
		}
	}

	async function importCards(): Promise<void> {
		if (busy || !rows.length) return;
		busy = true;
		error = '';
		try {
			const result = await api.importCards(
				dictionary.id,
				{ cards: rows.map((card) => ({ ...cardContent(card), folderId: folder || null })) },
				abort.signal
			);
			if (disposed) return;
			void changed(dictionary.id);
			notify(
				result.added +
					' cards imported.' +
					(result.skipped ? ' ' + result.skipped + ' duplicates skipped.' : '')
			);
			onClose();
		} catch (cause) {
			if (!disposed) error = errorMessage(cause);
		} finally {
			if (!disposed) busy = false;
		}
	}

	async function exportCards(): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const content = new Map<string, LingvoCardContent>();
			let total = 0;
			for (let offset = 0; offset === 0 || offset < total; offset += 200) {
				const page = await api.cards(dictionary.id, { limit: 200, offset }, abort.signal);
				if (disposed) return;
				if (offset && total !== page.total)
					throw new Error('Your dictionary changed during export. Please try again.');
				total = page.total;
				for (const card of page.items) content.set(card.id, cardContent(card));
				progress = content.size + ' / ' + total + ' cards';
			}
			if (!content.size) throw new Error('Add a few cards before exporting your dictionary.');
			if (content.size !== total)
				throw new Error('Your dictionary changed during export. Please try again.');
			const { downloadCSV } = await import('@kaordo/lingvo-client/csv');
			if (disposed) return;
			downloadCSV([...content.values()], 'lingvo-de-' + dictionary.nativeLanguage);
			notify('Your dictionary CSV is ready.');
		} catch (cause) {
			if (!disposed) error = errorMessage(cause);
		} finally {
			if (!disposed) {
				busy = false;
				progress = '';
			}
		}
	}

	async function template(): Promise<void> {
		try {
			const { downloadCSV } = await import('@kaordo/lingvo-client/csv');
			if (!disposed)
				downloadCSV(
					[
						{
							...emptyCard(),
							term: 'Buch',
							translation: dictionary.nativeLanguage === 'ru' ? 'книга' : 'book',
							partOfSpeech: 'noun',
							article: 'das',
							plural: 'die Bücher',
							example: 'Ich lese ein Buch.',
							exampleTranslation:
								dictionary.nativeLanguage === 'ru' ? 'Я читаю книгу.' : 'I am reading a book.'
						}
					],
					'lingvo-template'
				);
		} catch (cause) {
			if (!disposed) error = errorMessage(cause);
		}
	}
</script>

<Dialog.Root
	open={true}
	onOpenChange={(value) => {
		if (!value) onClose();
	}}
>
	<Dialog.Content class="flex max-h-[90dvh] flex-col sm:max-w-xl">
		<Dialog.Header
			><Dialog.Title>Bring your words with you</Dialog.Title><Dialog.Description
				>Import cards into this German · {dictionary.nativeLanguage === 'ru'
					? 'Russian'
					: 'English'} dictionary or save its content as a CSV.</Dialog.Description
			></Dialog.Header
		>
		<ToggleGroup.Root
			type="single"
			value={mode}
			onValueChange={(value) => {
				if (value && !busy) {
					mode = value;
					error = '';
				}
			}}
			class="w-full"
			variant="outline"
			aria-label="Dictionary transfer"
			><ToggleGroup.Item value="import" class="flex-1"
				><UploadIcon class="size-4" />Import</ToggleGroup.Item
			><ToggleGroup.Item value="export" class="flex-1"
				><DownloadIcon class="size-4" />Export</ToggleGroup.Item
			></ToggleGroup.Root
		>
		<div class="min-h-0 space-y-5 overflow-y-auto" inert={busy}>
			{#if mode === 'import'}
				<div>
					<label for={`${id}-csv`} class="mb-2 block text-sm font-semibold">CSV file</label><Input
						id={`${id}-csv`}
						type="file"
						accept=".csv,text/csv"
						disabled={busy}
						onchange={(event) => void selectFile(event)}
					/>
					<p class="mt-2 text-xs leading-5 text-muted-foreground">
						Up to 500 cards and 1 MiB. Required columns: term, translation. Optional: kind,
						partOfSpeech, article, plural, grammar, example, exampleTranslation, notes, status.
					</p>
					<Button class="mt-2" variant="ghost" size="xs" onclick={() => void template()}
						><DownloadIcon class="size-3.5" />Download a sample CSV</Button
					>
				</div>
				<div class="flex items-center gap-3">
					<span class="text-sm font-semibold">Import into</span><FolderPicker
						{folders}
						bind:value={folder}
					/>
				</div>
				{#if rows.length}
					<div class="overflow-hidden rounded-2xl border border-border">
						<p class="border-b border-border bg-muted/30 px-4 py-3 text-sm font-semibold">
							{rows.length} cards · {filename}
						</p>
						<ul class="divide-y divide-border">
							{#each rows.slice(0, 5) as card}<li class="px-4 py-3 text-sm">
									<p class="font-semibold" lang="de">
										{card.article ? card.article + ' ' : ''}{card.term}
									</p>
									<p class="mt-1 text-muted-foreground" lang={dictionary.nativeLanguage}>
										{card.translation}
									</p>
								</li>{/each}
						</ul>
						{#if rows.length > 5}<p
								class="border-t border-border px-4 py-2 text-xs text-muted-foreground"
							>
								And {rows.length - 5} more cards
							</p>{/if}
					</div>
				{/if}
				<p class="text-xs leading-5 text-muted-foreground">
					Repeated imports preserve cards you already imported. Each new card starts its own
					learning schedule.
				</p>
			{:else}
				<div class="rounded-2xl border border-border bg-muted/30 p-5">
					<h2 class="text-base font-semibold">Your whole dictionary</h2>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						The CSV includes German text, translations, grammar, examples and card status. Learning
						history stays with this dictionary.
					</p>
				</div>
			{/if}
		</div>
		{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		{#if progress}<p role="status" class="text-xs text-muted-foreground">{progress}</p>{/if}
		<Dialog.Footer
			><Button variant="outline" onclick={onClose}>Close</Button><Button
				disabled={busy || (mode === 'import' && !rows.length)}
				onclick={() => void (mode === 'import' ? importCards() : exportCards())}
				>{#if busy}<LoaderCircleIcon
						class="size-4 motion-safe:animate-spin"
					/>{:else if mode === 'import'}<UploadIcon class="size-4" />{:else}<DownloadIcon
						class="size-4"
					/>{/if}{mode === 'import' ? 'Import cards' : 'Download CSV'}</Button
			></Dialog.Footer
		>
	</Dialog.Content>
</Dialog.Root>
