<script lang="ts">
	// Edits personal words and phrases with German grammar fields and revision-safe saves
	import { onDestroy, untrack } from 'svelte';
	import type {
		LingvoCard,
		LingvoCardContent,
		LingvoDictionary,
		LingvoFolder
	} from '@kaordo/contracts';
	import { cardContent } from '@kaordo/lingvo-client';
	import {
		Button,
		ChevronDownIcon,
		Dialog,
		DropdownMenu,
		Input,
		LoaderCircleIcon,
		RadioGroup,
		Textarea,
		ToggleGroup
	} from '@kaordo/ui';
	import { errorMessage, getLingvoContext } from './lingvo-context';
	import CardAIInput from './CardAIInput.svelte';
	import FolderPicker from './FolderPicker.svelte';

	let {
		dictionary,
		initial,
		folders,
		onClose
	}: {
		dictionary: LingvoDictionary;
		initial: LingvoCardContent | LingvoCard;
		folders: LingvoFolder[];
		onClose(): void;
	} = $props();
	const { api, changed, notify } = getLingvoContext();
	const id = $props.id();
	const createId = crypto.randomUUID();
	const parts = [
		{ value: '', label: 'Not specified' },
		{ value: 'noun', label: 'Noun' },
		{ value: 'verb', label: 'Verb' },
		{ value: 'adjective', label: 'Adjective' },
		{ value: 'adverb', label: 'Adverb' },
		{ value: 'other', label: 'Other' }
	] as const;
	let draft = $state(cardContent(untrack(() => initial)));
	let folder = $state(untrack(() => initial.folderId ?? ''));
	let busy = $state(false);
	let error = $state('');
	let open = $state(true);
	let detailsOpen = $state(false);
	let disposed = false;
	const abort = new AbortController();
	const editing = $derived('id' in initial);
	const nativeName = $derived(dictionary.nativeLanguage === 'ru' ? 'Russian' : 'English');
	onDestroy(() => {
		disposed = true;
		abort.abort();
	});

	function changeKind(value: string): void {
		if (value !== 'word' && value !== 'phrase') return;
		draft.kind = value;
		if (value === 'phrase') {
			draft.article = '';
			draft.partOfSpeech = '';
			draft.plural = '';
		}
	}

	function changePart(value: string): void {
		if (!parts.some((part) => part.value === value)) return;
		draft.partOfSpeech = value as LingvoCardContent['partOfSpeech'];
		if (value !== 'noun') {
			draft.article = '';
			draft.plural = '';
		}
	}

	function changeArticle(value: string): void {
		if (value === 'none') draft.article = '';
		else if (value === 'der' || value === 'die' || value === 'das') {
			draft.article = value;
			draft.partOfSpeech = 'noun';
		}
	}

	function applyAI(card: LingvoCardContent): void {
		draft = card;
		folder = card.folderId ?? '';
		detailsOpen = !!(
			card.plural ||
			card.grammar ||
			card.example ||
			card.exampleTranslation ||
			card.notes
		);
		error = '';
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const input = { ...cardContent(draft), folderId: folder || null };
			if ('id' in initial)
				await api.updateCard(
					dictionary.id,
					initial.id,
					{ ...input, revision: initial.revision },
					abort.signal
				);
			else await api.createCard(dictionary.id, { ...input, id: createId }, abort.signal);
			if (disposed) return;
			void changed(dictionary.id);
			notify(editing ? 'Card updated.' : 'Card added to your dictionary.');
			onClose();
		} catch (cause) {
			if (!disposed) error = errorMessage(cause);
		} finally {
			if (!disposed) busy = false;
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value) onClose();
	}}
>
	<Dialog.Content
		class="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-2xl"
	>
		<Dialog.Header class="shrink-0 pr-8">
			<Dialog.Title>{editing ? 'Edit card' : 'Add a card'}</Dialog.Title>
			<Dialog.Description>A word or phrase, with its {nativeName} translation.</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={save} class="flex min-h-0 flex-col gap-4" aria-busy={busy}>
			<div class="min-h-0 space-y-4 overflow-y-auto pr-1" inert={busy}>
				<ToggleGroup.Root
					type="single"
					bind:value={() => draft.kind, changeKind}
					variant="outline"
					aria-label="Card type"
					class="w-full"
				>
					<ToggleGroup.Item value="word" class="flex-1">Word</ToggleGroup.Item>
					<ToggleGroup.Item value="phrase" class="flex-1">Phrase</ToggleGroup.Item>
				</ToggleGroup.Root>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<label for={`${id}-term`} class="text-sm font-semibold"
							>{draft.kind === 'word' ? 'German word' : 'German phrase'}</label
						>
						<Input
							id={`${id}-term`}
							bind:value={draft.term}
							lang="de"
							required
							maxlength={300}
							placeholder={draft.kind === 'word' ? 'e.g. Erinnerung' : 'e.g. Einen Kaffee, bitte.'}
						/>
					</div>
					<div class="space-y-2">
						<label for={`${id}-translation`} class="text-sm font-semibold"
							>{nativeName} translation</label
						>
						<Input
							id={`${id}-translation`}
							bind:value={draft.translation}
							lang={dictionary.nativeLanguage}
							required
							maxlength={500}
						/>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-x-5 gap-y-3">
					{#if draft.kind === 'word'}
						<div class="flex items-center gap-2">
							<span class="text-sm text-muted-foreground">Word type</span>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="outline" size="sm" aria-label="Part of speech"
											>{parts.find((part) => part.value === draft.partOfSpeech)
												?.label}<ChevronDownIcon class="size-3.5" /></Button
										>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content>
									<DropdownMenu.RadioGroup bind:value={() => draft.partOfSpeech, changePart}>
										{#each parts as part}<DropdownMenu.RadioItem value={part.value} closeOnSelect
												>{part.label}</DropdownMenu.RadioItem
											>{/each}
									</DropdownMenu.RadioGroup>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/if}
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground">Folder</span><FolderPicker
							{folders}
							bind:value={folder}
						/>
					</div>
				</div>
				{#if draft.kind === 'word' && (!draft.partOfSpeech || draft.partOfSpeech === 'noun')}
					<div class="space-y-2">
						<p id={`${id}-article`} class="text-sm font-semibold">Article</p>
						<RadioGroup.Root
							bind:value={() => draft.article || 'none', changeArticle}
							aria-labelledby={`${id}-article`}
							class="grid grid-cols-2 gap-2 sm:grid-cols-4"
						>
							{#each ['none', 'der', 'die', 'das'] as article}
								<label
									for={`${id}-article-${article}`}
									class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-2 py-2 transition-[background-color,border-color,box-shadow] has-focus-visible:ring-2 has-focus-visible:ring-ring/40 has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:shadow-sm motion-reduce:transition-none"
								>
									<RadioGroup.Item id={`${id}-article-${article}`} value={article} />
									{#if article === 'none'}<span class="text-sm">None</span>{:else}<span
											class="german-article text-sm"
											lang="de"
											data-article={article}>{article}</span
										>{/if}
								</label>
							{/each}
						</RadioGroup.Root>
					</div>
				{/if}
				<details bind:open={detailsOpen} class="group rounded-xl border border-border">
					<summary
						class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden"
					>
						More details <span class="ml-auto text-xs font-normal text-muted-foreground"
							>Optional</span
						>
						<ChevronDownIcon
							class="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
						/>
					</summary>
					<div class="space-y-4 border-t border-border p-4">
						<div class="grid gap-4 sm:grid-cols-2">
							{#if draft.kind === 'word' && draft.partOfSpeech === 'noun'}
								<div class="space-y-2">
									<label for={`${id}-plural`} class="text-sm font-semibold">Plural</label>
									<Input
										id={`${id}-plural`}
										bind:value={draft.plural}
										lang="de"
										maxlength={100}
										placeholder="e.g. die Erinnerungen"
									/>
								</div>
							{/if}
							<div
								class={draft.kind === 'word' && draft.partOfSpeech === 'noun'
									? 'space-y-2'
									: 'space-y-2 sm:col-span-2'}
							>
								<label for={`${id}-grammar`} class="text-sm font-semibold"
									>{draft.partOfSpeech === 'verb' ? 'Verb forms' : 'Grammar note'}</label
								>
								<Input
									id={`${id}-grammar`}
									bind:value={draft.grammar}
									maxlength={500}
									placeholder={draft.partOfSpeech === 'verb'
										? 'e.g. sehen · sieht · sah · hat gesehen'
										: 'A useful pattern or a memory cue'}
								/>
							</div>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-2">
								<label for={`${id}-example`} class="text-sm font-semibold">Example</label>
								<Input
									id={`${id}-example`}
									bind:value={draft.example}
									lang="de"
									maxlength={500}
									placeholder="A sentence in German"
								/>
							</div>
							<div class="space-y-2">
								<label for={`${id}-example-translation`} class="text-sm font-semibold"
									>Example translation</label
								>
								<Input
									id={`${id}-example-translation`}
									bind:value={draft.exampleTranslation}
									lang={dictionary.nativeLanguage}
									maxlength={500}
									placeholder="Its translation"
								/>
							</div>
						</div>
						<div class="space-y-2">
							<label for={`${id}-notes`} class="text-sm font-semibold">Personal note</label>
							<Textarea id={`${id}-notes`} bind:value={draft.notes} maxlength={1000} rows={2} />
						</div>
					</div>
				</details>
				<CardAIInput
					card={{ ...draft, folderId: folder || null }}
					nativeLanguage={dictionary.nativeLanguage}
					{folders}
					saveLabel={editing ? 'Save card' : 'Add card'}
					onApply={applyAI}
				/>
			</div>
			{#if error}<p class="shrink-0 text-sm text-destructive" role="alert">{error}</p>{/if}
			<Dialog.Footer class="shrink-0 border-t border-border pt-4">
				<Button variant="outline" onclick={onClose}>Cancel</Button>
				<Button type="submit" disabled={busy}
					>{#if busy}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{/if}{editing
						? 'Save card'
						: 'Add card'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
