<script lang="ts">
	// Coordinates language-pair navigation, personal dictionaries and shared learning views
	import { onDestroy, onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery, QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import {
		createLingvoApi,
		lingvoDictionariesOptions,
		lingvoOverviewOptions
	} from '@kaordo/api-client';
	import type { LingvoCard, LingvoCardContent, UserIdentity } from '@kaordo/contracts';
	import { emptyCard, nativeLanguages } from '@kaordo/lingvo-client';
	import { appPaths } from '@kaordo/links';
	import {
		AppHeader,
		BookOpenIcon,
		Button,
		CheckIcon,
		ChevronDownIcon,
		Dialog,
		DropdownMenu,
		GraduationCapIcon,
		LanguagesIcon,
		LayersIcon,
		LoaderCircleIcon,
		MessageCircleIcon,
		PlusIcon,
		RadioGroup,
		SettingsIcon,
		SparklesIcon,
		UploadIcon,
		XIcon
	} from '@kaordo/ui';
	import { errorMessage, setLingvoContext, type CardKind, type LingvoView } from './lingvo-context';

	let { user }: { user: UserIdentity } = $props();
	const api = createLingvoApi(import.meta.env.VITE_KAORDO_API_URL);
	const queryClient = new QueryClient();
	const dictionariesQuery = createQuery(
		() => lingvoDictionariesOptions(api),
		() => queryClient
	);
	const dictionaries = $derived(dictionariesQuery.data?.items ?? []);
	const dictionaryId = $derived(
		dictionaries.find((item) => item.id === page.url.searchParams.get('dictionary'))?.id ?? ''
	);
	const dictionary = $derived(dictionaries.find((item) => item.id === dictionaryId) ?? null);
	const overviewQuery = createQuery(
		() => lingvoOverviewOptions(api, dictionaryId),
		() => queryClient
	);
	const overview = $derived(overviewQuery.data ?? null);
	const views: LingvoView[] = ['learn', 'phrases', 'dictionary', 'library', 'study'];
	const view = $derived(
		views.find((item) => item === page.url.searchParams.get('view')) ?? 'learn'
	);
	const kind = $derived<CardKind>(
		page.url.searchParams.get('kind') === 'phrase' ? 'phrase' : 'word'
	);
	const rawFolder = $derived(page.url.searchParams.get('folder') ?? '');
	const folder = $derived(
		rawFolder === 'none' || overview?.folders.some((item) => item.id === rawFolder) ? rawFolder : ''
	);
	const nav = [
		{ view: 'learn', label: 'Learn words', icon: GraduationCapIcon },
		{ view: 'phrases', label: 'Practice phrases', icon: MessageCircleIcon },
		{ view: 'dictionary', label: 'My dictionary', icon: BookOpenIcon },
		{ view: 'library', label: 'Library', icon: LayersIcon }
	] as const;
	let panel = $state<'languages' | 'settings' | 'transfer' | null>(null);
	let editor = $state<LingvoCardContent | LingvoCard | null>(null);
	let nativeLanguage = $state<'ru' | 'en'>('ru');
	let timeZone = $state('UTC');
	let creating = $state(false);
	let createError = $state('');
	let message = $state('');
	let viewAttempt = $state(0);
	let dialogAttempt = $state(0);
	let messageTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	const abort = new AbortController();
	const formId = $props.id();

	setLingvoContext({
		api,
		queryClient,
		notify,
		changed: async (id) => {
			if (disposed) return;
			await queryClient.invalidateQueries({ queryKey: ['lingvo', id] });
		}
	});

	$effect(() => {
		if (!dictionaryId && dictionaries.length && !creating)
			void navigate('learn', dictionaries[0].id, 'word', '', true);
	});
	$effect(() => {
		dictionaryId;
		view;
		untrack(() => {
			editor = null;
			panel = null;
		});
	});
	$effect(() => {
		if (overview && rawFolder && !folder) void navigate(view, dictionaryId, kind, '', true);
	});
	onMount(() => {
		timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	});
	onDestroy(() => {
		disposed = true;
		abort.abort();
		void queryClient.cancelQueries();
		queryClient.clear();
		if (messageTimer) clearTimeout(messageTimer);
	});

	function href(
		nextView: LingvoView,
		id = dictionaryId,
		nextKind: CardKind = kind,
		nextFolder = ''
	): string {
		const params = new URLSearchParams({ dictionary: id, view: nextView });
		if (nextView === 'study' || nextView === 'dictionary') params.set('kind', nextKind);
		if (nextFolder) params.set('folder', nextFolder);
		return appPaths.lingvo + '?' + params.toString();
	}

	async function navigate(
		nextView: LingvoView,
		id = dictionaryId,
		nextKind: CardKind = kind,
		nextFolder = '',
		replaceState = false
	): Promise<void> {
		await goto(href(nextView, id, nextKind, nextFolder), {
			noScroll: true,
			keepFocus: true,
			replaceState
		});
	}

	function notify(value: string): void {
		if (disposed) return;
		message = value;
		if (messageTimer) clearTimeout(messageTimer);
		messageTimer = setTimeout(() => {
			message = '';
		}, 6000);
	}

	async function createDictionary(): Promise<void> {
		if (creating) return;
		creating = true;
		createError = '';
		try {
			const result = await api.createDictionary(
				{ learningLanguage: 'de', nativeLanguage, timeZone },
				abort.signal
			);
			if (disposed) return;
			await queryClient.invalidateQueries({ queryKey: ['lingvo', 'dictionaries'] });
			if (disposed) return;
			panel = null;
			await navigate('library', result.id);
		} catch (cause) {
			if (!disposed) createError = errorMessage(cause);
		} finally {
			if (!disposed) creating = false;
		}
	}
</script>

{#snippet languageForm()}
	<div class="space-y-6">
		<div>
			<p class="lingvo-eyebrow mb-3">I want to learn</p>
			<div class="flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
				<span class="german-flag" aria-hidden="true"></span>
				<div>
					<p class="text-lg font-semibold">
						German <span class="ml-1 text-sm font-normal text-muted-foreground">Deutsch</span>
					</p>
					<p class="text-sm text-muted-foreground">Words, articles and everyday phrases</p>
				</div>
				<span
					class="ml-auto grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
					aria-hidden="true"><CheckIcon class="size-4" /></span
				>
			</div>
		</div>
		<div inert={creating}>
			<p class="lingvo-eyebrow mb-3" id={`${formId}-native`}>My native language</p>
			<RadioGroup.Root
				aria-labelledby={`${formId}-native`}
				value={nativeLanguage}
				onValueChange={(value) => {
					nativeLanguage = value as 'ru' | 'en';
				}}
				class="grid grid-cols-2 gap-3"
			>
				{#each nativeLanguages as language}
					<label
						for={`${formId}-${language.code}`}
						class="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-[background-color,border-color,box-shadow] has-focus-visible:ring-2 has-focus-visible:ring-ring/40 has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:shadow-sm motion-reduce:transition-none"
					>
						<RadioGroup.Item id={`${formId}-${language.code}`} value={language.code} />
						<span
							><span class="block font-semibold">{language.name}</span><span
								class="text-xs text-muted-foreground"
								lang={language.code}>{language.nativeName}</span
							></span
						>
					</label>
				{/each}
			</RadioGroup.Root>
			<p class="mt-3 text-xs leading-5 text-muted-foreground">
				Each language pair has its own dictionary and learning progress.
			</p>
		</div>
		{#if createError}<p class="text-sm text-destructive" role="alert">{createError}</p>{/if}
		<Button class="w-full" size="lg" disabled={creating} onclick={() => void createDictionary()}>
			{#if creating}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{:else}<SparklesIcon
					class="size-4"
				/>{/if}Open my dictionary
		</Button>
	</div>
{/snippet}

{#snippet loadingView()}
	<p role="status" class="py-16 text-center text-muted-foreground">Opening your language space…</p>
{/snippet}
{#snippet loadFailure(cause: unknown, retry: () => void)}
	<div class="lingvo-surface p-6">
		<p role="alert" class="text-sm text-destructive">
			Could not open this view. {errorMessage(cause)}
		</p>
		<Button class="mt-4" variant="outline" onclick={retry}>Try again</Button>
	</div>
{/snippet}

<QueryClientProvider client={queryClient}>
	<div class="min-h-dvh bg-background">
		<AppHeader name="Lingvo" homeHref={appPaths.portal} />
		<main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
			{#if dictionariesQuery.isError}
				<div class="lingvo-surface p-8">
					<p role="alert" class="text-destructive">{errorMessage(dictionariesQuery.error)}</p>
					<Button class="mt-4" variant="outline" onclick={() => void dictionariesQuery.refetch()}
						>Try again</Button
					>
				</div>
			{:else if dictionariesQuery.isPending || (dictionaries.length && !dictionary)}
				<p role="status" class="py-24 text-center text-muted-foreground">
					Preparing your dictionaries…
				</p>
			{:else if !dictionaries.length}
				<section
					class="lingvo-enter mx-auto grid max-w-4xl items-center gap-10 py-4 lg:grid-cols-2 lg:py-16"
				>
					<div>
						<span
							class="mb-6 grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground"
							><LanguagesIcon class="size-8" /></span
						>
						<p class="lingvo-eyebrow text-link">Welcome to Lingvo</p>
						<h1 class="mt-3 text-4xl leading-tight font-bold tracking-[-0.045em] sm:text-5xl">
							Little moments.<br />A whole new language.
						</h1>
						<p class="mt-5 text-lg leading-8 text-muted-foreground">
							Build your personal German dictionary. Learn words with flashcards, put phrases
							together and return just when you need to.
						</p>
						<p class="mt-5 text-sm text-muted-foreground">
							Your cards and progress stay with your Kaordo account.
						</p>
					</div>
					<div class="lingvo-surface p-6 sm:p-8">{@render languageForm()}</div>
				</section>
			{:else if dictionary}
				<div class="flex flex-wrap items-center justify-between gap-3">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="sm"
									class="gap-2"
									aria-label="Select language pair"
								>
									<span class="german-flag small" aria-hidden="true"></span>German
									<span class="font-normal text-muted-foreground"
										>· {dictionary.nativeLanguage === 'ru' ? 'Russian' : 'English'}</span
									>
									<ChevronDownIcon class="size-3.5 text-muted-foreground" />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start">
							<DropdownMenu.Label>{user.displayName}'s dictionaries</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								value={dictionaryId}
								onValueChange={(value) => {
									if (value) void navigate('learn', value);
								}}
							>
								{#each dictionaries as item}<DropdownMenu.RadioItem value={item.id}
										>German · {item.nativeLanguage === 'ru'
											? 'Russian'
											: 'English'}</DropdownMenu.RadioItem
									>{/each}
							</DropdownMenu.RadioGroup>
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								onSelect={() => {
									createError = '';
									panel = 'languages';
								}}><PlusIcon />Add language pair</DropdownMenu.Item
							>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<div class="flex items-center gap-2">
						<Button
							onclick={() => {
								editor = emptyCard(
									view === 'phrases' ? 'phrase' : kind,
									folder && folder !== 'none' ? folder : null
								);
							}}><PlusIcon class="size-4" />Add card</Button
						>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}<Button
										{...props}
										variant="outline"
										size="icon"
										aria-label="Dictionary settings"><SettingsIcon class="size-4" /></Button
									>{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item
									onSelect={() => {
										panel = 'settings';
									}}><SettingsIcon />Learning preferences</DropdownMenu.Item
								>
								<DropdownMenu.Item
									onSelect={() => {
										panel = 'transfer';
									}}><UploadIcon />Import / export cards</DropdownMenu.Item
								>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</div>
				<nav
					class="my-5 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/35 p-1.5 sm:flex"
					aria-label="Lingvo"
				>
					{#each nav as item}
						{@const Icon = item.icon}
						{@const active =
							view === item.view ||
							(view === 'study' && item.view === (kind === 'phrase' ? 'phrases' : 'learn'))}
						<a
							href={href(item.view)}
							aria-current={active ? 'page' : undefined}
							class="lingvo-control flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-center text-xs font-semibold text-muted-foreground transition-[background-color,color,box-shadow] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-sm sm:px-3 sm:text-sm"
							><Icon class="size-4 shrink-0" /><span>{item.label}</span></a
						>
					{/each}
				</nav>
				{#if overviewQuery.isError}
					<div class="lingvo-surface p-8">
						<p role="alert" class="text-destructive">{errorMessage(overviewQuery.error)}</p>
						<Button class="mt-4" variant="outline" onclick={() => void overviewQuery.refetch()}
							>Try again</Button
						>
					</div>
				{:else if !overview}
					<p role="status" class="py-24 text-center text-muted-foreground">
						Loading your progress…
					</p>
				{:else}
					{#key dictionaryId + ':' + view + ':' + viewAttempt + ':' + (view === 'study' ? kind + ':' + folder : '')}
						<div class="lingvo-enter">
							{#if view === 'study'}
								{#await import('./Study.svelte')}{@render loadingView()}{:then { default: Study }}
									<Study
										{dictionary}
										{overview}
										{kind}
										{folder}
										paused={!!panel || !!editor}
										onExit={() => void navigate(kind === 'phrase' ? 'phrases' : 'learn')}
										onLibrary={() => void navigate('library')}
									/>
								{:catch cause}{@render loadFailure(cause, () => {
										viewAttempt += 1;
									})}{/await}
							{:else if view === 'dictionary'}
								{#await import('./Dictionary.svelte')}{@render loadingView()}{:then { default: Dictionary }}
									<Dictionary
										{dictionary}
										folders={overview.folders}
										{kind}
										{folder}
										onEdit={(card) => {
											editor = card;
										}}
										onFilter={(nextKind, nextFolder) =>
											void navigate('dictionary', dictionaryId, nextKind, nextFolder, true)}
										onStudy={() => void navigate('study', dictionaryId, kind, folder)}
									/>
								{:catch cause}{@render loadFailure(cause, () => {
										viewAttempt += 1;
									})}{/await}
							{:else if view === 'library'}
								{#await import('./Library.svelte')}{@render loadingView()}{:then { default: Library }}
									<Library
										{dictionary}
										folders={overview.folders}
										onStudy={(nextKind) => void navigate('study', dictionaryId, nextKind)}
									/>
								{:catch cause}{@render loadFailure(cause, () => {
										viewAttempt += 1;
									})}{/await}
							{:else}
								{#await import('./Dashboard.svelte')}{@render loadingView()}{:then { default: Dashboard }}
									<Dashboard
										{overview}
										kind={view === 'phrases' ? 'phrase' : 'word'}
										onStudy={(nextKind) => void navigate('study', dictionaryId, nextKind)}
										onLibrary={() => void navigate('library')}
										onPreferences={() => {
											panel = 'settings';
										}}
									/>
								{:catch cause}{@render loadFailure(cause, () => {
										viewAttempt += 1;
									})}{/await}
							{/if}
						</div>
					{/key}
				{/if}
				{#key dialogAttempt}
					{#if editor}
						{#await import('./CardEditor.svelte')}{@render loadingView()}{:then { default: CardEditor }}
							<CardEditor
								{dictionary}
								initial={editor}
								folders={overview?.folders ?? []}
								onClose={() => {
									editor = null;
								}}
							/>
						{:catch cause}{@render loadFailure(cause, () => {
								dialogAttempt += 1;
							})}{/await}
					{/if}
					{#if panel === 'settings'}
						{#await import('./Preferences.svelte')}{@render loadingView()}{:then { default: Preferences }}
							<Preferences
								{dictionary}
								onClose={() => {
									panel = null;
								}}
							/>
						{:catch cause}{@render loadFailure(cause, () => {
								dialogAttempt += 1;
							})}{/await}
					{/if}
					{#if panel === 'transfer'}
						{#await import('./Transfer.svelte')}{@render loadingView()}{:then { default: Transfer }}
							<Transfer
								{dictionary}
								folders={overview?.folders ?? []}
								onClose={() => {
									panel = null;
								}}
							/>
						{:catch cause}{@render loadFailure(cause, () => {
								dialogAttempt += 1;
							})}{/await}
					{/if}
				{/key}
			{/if}
		</main>
		<div
			class="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2"
			aria-live="polite"
			aria-atomic="true"
		>
			{#if message}<div
					class="lingvo-enter pointer-events-auto flex items-center gap-3 rounded-2xl border border-border bg-popover p-4 text-sm shadow-lg"
				>
					<span class="flex-1">{message}</span><Button
						variant="ghost"
						size="icon-xs"
						aria-label="Dismiss message"
						onclick={() => {
							message = '';
						}}><XIcon /></Button
					>
				</div>{/if}
		</div>
	</div>

	<Dialog.Root
		open={panel === 'languages'}
		onOpenChange={(value) => {
			if (!value) panel = null;
		}}
	>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header
				><Dialog.Title>Add a language pair</Dialog.Title><Dialog.Description
					>Start a separate dictionary or open one you already have.</Dialog.Description
				></Dialog.Header
			>
			{@render languageForm()}
		</Dialog.Content>
	</Dialog.Root>
</QueryClientProvider>

<style>
	.german-flag {
		display: inline-block;
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		border-radius: 0.9rem;
		background: linear-gradient(#252525 0 33.333%, #d34747 33.333% 66.666%, #ecc65b 66.666%);
		box-shadow: inset 0 0 0 1px #00000015;
	}
	.german-flag.small {
		width: 1.65rem;
		height: 1.65rem;
		border-radius: 0.5rem;
	}
</style>
