<script lang="ts">
	// Presents due-card practice with answer previews, focus, gestures and pronunciation
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import type { LingvoDictionary, LingvoOverview, LingvoReview } from '@kaordo/contracts';
	import { germanTerm, Pronunciation, ratings } from '@kaordo/lingvo-client';
	import { reviewIntervals } from '@kaordo/lingvo-client/scheduler';
	import {
		Button,
		CheckIcon,
		ChevronDownIcon,
		ChevronLeftIcon,
		DropdownMenu,
		HeadphonesIcon,
		LayersIcon,
		LoaderCircleIcon,
		RotateCcwIcon,
		SparklesIcon,
		Volume2Icon
	} from '@kaordo/ui';
	import { dueDate, errorMessage, getLingvoContext, type CardKind } from './lingvo-context';
	import CardDefinition from './CardDefinition.svelte';
	import PhraseExercise from './PhraseExercise.svelte';
	import { createStudyState } from './study-state.svelte';

	let {
		dictionary,
		overview,
		kind,
		folder,
		paused = false,
		onExit,
		onLibrary
	}: {
		dictionary: LingvoDictionary;
		overview: LingvoOverview;
		kind: CardKind;
		folder: string;
		paused?: boolean;
		onExit(this: void): void;
		onLibrary(this: void): void;
	} = $props();
	const { api, queryClient, changed, notify } = getLingvoContext();
	const pronunciation = new Pronunciation();
	const progress = createStudyState({
		api,
		queryClient,
		dictionaryId: () => dictionary.id,
		kind: () => kind,
		folder: () => folder,
		onCardChanged: resetAnswer,
		onReviewSaved: () => pronunciation.stop(),
		changed,
		notify
	});
	const study = progress.query;
	const modes = [
		{ value: 'mixed', label: 'Both directions' },
		{ value: 'recognition', label: 'German → translation' },
		{ value: 'recall', label: 'Translation → German' },
		{ value: 'listening', label: 'Listen and recall' }
	];
	let mode = $state('mixed');
	const active = $derived(progress.active);
	let revealed = $state(false);
	let correct = $state<boolean | null>(null);
	let hinted = $state(false);
	const busy = $derived(progress.busy);
	const completed = $derived(progress.completed);
	const error = $derived(progress.error);
	const pending = $derived(progress.pending);
	const undoId = $derived(progress.undoId);
	let reducedMotion = $state(true);
	let practice = $state<HTMLElement>();
	let recall = $state<HTMLElement>();
	let question = $state<HTMLElement>();
	let dragX = $state(0);
	let gesture: { id: number; x: number; y: number } | null = null;
	let disposed = false;
	const direction = $derived<LingvoReview['direction']>(
		kind === 'phrase'
			? 'phrase'
			: mode === 'mixed'
				? (active?.schedule.reps ?? 0) % 2
					? 'recall'
					: 'recognition'
				: (mode as LingvoReview['direction'])
	);
	const intervals = $derived(active ? reviewIntervals(active.schedule) : null);
	const counts = $derived(overview.counts.find((item) => item.kind === kind));
	const nextDue = $derived(counts?.nextDue);

	$effect(() => {
		// Restore question focus only when the active card changes
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Explicit dependency reads limit this Svelte effect to the selected identity
		[active?.id, active?.revision];
		untrack(() => {
			if (active)
				void tick().then(() => {
					const focused = document.activeElement;
					if (
						!disposed &&
						!paused &&
						!revealed &&
						(focused === document.body || practice?.contains(focused))
					)
						question?.focus({ preventScroll: true });
				});
		});
	});
	onMount(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => {
			reducedMotion = media.matches;
		};
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});
	onDestroy(() => {
		disposed = true;
		progress.dispose();
		pronunciation.dispose();
	});

	// Move focus out of the card face before it becomes inert and into the next available action
	$effect(() => {
		if (revealed)
			void tick().then(() => {
				if (!disposed && revealed)
					recall
						?.querySelector<HTMLButtonElement>('button:not(:disabled)')
						?.focus({ preventScroll: true });
			});
	});

	function resetAnswer(): void {
		revealed = false;
		correct = null;
		hinted = false;
		dragX = 0;
		progress.clearError();
		pronunciation.stop();
	}

	function speak(text: string): void {
		if (!pronunciation.speak(text)) notify('Speech playback is unavailable in this browser.');
	}

	async function save(rating?: LingvoReview['rating']): Promise<void> {
		if (revealed) await progress.save(direction, rating);
	}

	function keyboard(event: KeyboardEvent): void {
		if (
			event.defaultPrevented ||
			event.repeat ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			busy ||
			pending ||
			paused ||
			!active ||
			!practice?.contains(document.activeElement)
		)
			return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest('input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]')
		)
			return;
		if (document.querySelector('[data-slot=dialog-content],[data-slot=dropdown-menu-content]'))
			return;
		if (
			event.code === 'Space' &&
			kind === 'word' &&
			!revealed &&
			!(target instanceof HTMLElement && target.closest('button,a'))
		) {
			event.preventDefault();
			revealed = true;
			return;
		}
		if (!revealed) return;
		const rating =
			event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? 3 : Number(event.key);
		if (rating >= 1 && rating <= 4) {
			event.preventDefault();
			void save(rating as LingvoReview['rating']);
		}
	}

	function pointerDown(event: PointerEvent): void {
		if (
			!revealed ||
			busy ||
			pending ||
			!event.isPrimary ||
			event.button !== 0 ||
			(event.target instanceof Element && event.target.closest('button,a,input,textarea'))
		)
			return;
		gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function pointerMove(event: PointerEvent): void {
		if (gesture?.id !== event.pointerId) return;
		const x = event.clientX - gesture.x;
		if (Math.abs(x) > Math.abs(event.clientY - gesture.y)) dragX = Math.max(-150, Math.min(150, x));
	}

	function pointerEnd(event: PointerEvent): void {
		if (gesture?.id !== event.pointerId) return;
		const movement = dragX;
		gesture = null;
		dragX = 0;
		if (event.type !== 'pointercancel' && Math.abs(movement) > 80) void save(movement > 0 ? 3 : 1);
	}
</script>

<svelte:window onkeydown={keyboard} />

<section
	bind:this={practice}
	class="mx-auto max-w-3xl"
	aria-labelledby="practice-heading"
	tabindex="-1"
>
	<h1 id="practice-heading" class="sr-only">
		{kind === 'word' ? 'Flashcard practice' : 'Phrase practice'}
	</h1>
	<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<Button variant="ghost" size="sm" onclick={onExit}
			><ChevronLeftIcon class="size-4" />{kind === 'word' ? 'Words' : 'Phrases'}</Button
		>
		<div class="flex items-center gap-2">
			<span class="text-xs text-muted-foreground">{completed} reviewed</span>
			<Button
				variant="ghost"
				size="sm"
				disabled={!undoId || busy || !!pending}
				onclick={() => void progress.undo()}
				title="Undo the last answer within 10 minutes"><RotateCcwIcon class="size-4" />Undo</Button
			>
			{#if kind === 'word'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						>{#snippet child({ props })}<Button {...props} variant="outline" size="sm"
								>{modes.find((item) => item.value === mode)?.label}<ChevronDownIcon
									class="size-3.5"
								/></Button
							>{/snippet}</DropdownMenu.Trigger
					>
					<DropdownMenu.Content align="end"
						><DropdownMenu.Label>Practice direction</DropdownMenu.Label><DropdownMenu.RadioGroup
							value={mode}
							onValueChange={(value: string) => {
								if (!busy && !pending) {
									mode = value;
									resetAnswer();
								}
							}}
							>{#each modes as item (item.value)}<DropdownMenu.RadioItem value={item.value}
									>{item.label}</DropdownMenu.RadioItem
								>{/each}</DropdownMenu.RadioGroup
						></DropdownMenu.Content
					>
				</DropdownMenu.Root>
			{/if}
		</div>
	</div>
	{#if active}
		{#key `${active.id}:${active.revision}`}
			<div in:fly={{ y: reducedMotion ? 0 : 12, duration: reducedMotion ? 0 : 200 }}>
				<div
					class="card-scene"
					role="group"
					aria-label="Study card"
					onpointerdown={pointerDown}
					onpointermove={pointerMove}
					onpointerup={pointerEnd}
					onpointercancel={pointerEnd}
					style={`transform: translateX(${dragX}px) rotate(${dragX / 25}deg);`}
				>
					{#if Math.abs(dragX) > 20}<span class="swipe-label" class:forgot={dragX < 0}
							>{dragX > 0 ? 'Remembered' : 'Forgot'}</span
						>{/if}
					<div class="card-turner" class:turned={revealed}>
						<div
							bind:this={question}
							class="lingvo-surface card-face card-front p-6 sm:p-9"
							role="group"
							aria-label="Question"
							tabindex="-1"
							inert={revealed}
							aria-hidden={revealed}
						>
							{#if kind === 'phrase'}
								<p class="lingvo-eyebrow text-center">Say it in German</p>
								<p
									class="mt-4 mb-7 text-center text-xl font-semibold sm:text-2xl"
									lang={dictionary.nativeLanguage}
								>
									{active.translation}
								</p>
								<PhraseExercise
									card={active}
									onReveal={(answerCorrect: boolean, usedHint: boolean) => {
										correct = answerCorrect;
										hinted = usedHint;
										revealed = true;
									}}
								/>
							{:else}
								<p class="lingvo-eyebrow text-center">
									{direction === 'recall'
										? 'Say it in German'
										: direction === 'listening'
											? 'Listen and recall'
											: 'What does it mean?'}
								</p>
								{#if direction === 'listening'}
									<div class="my-8 flex flex-col items-center gap-3">
										<Button
											class="size-20 rounded-full shadow-md"
											size="icon-lg"
											aria-label="Play German word"
											onclick={() => speak(germanTerm(active))}
											><HeadphonesIcon class="size-8" /></Button
										>
										<p class="text-sm text-muted-foreground">Listen, then think of the meaning.</p>
									</div>
								{:else}
									<p
										class="my-10 text-center text-3xl font-bold tracking-tight sm:text-4xl"
										lang={direction === 'recall' ? dictionary.nativeLanguage : 'de'}
									>
										{#if direction === 'recall'}{active.translation}{:else}{#if active.article}<span
													class="german-article mr-2"
													data-article={active.article}>{active.article}</span
												>{/if}{active.term}{/if}
									</p>
									{#if direction === 'recognition'}<Button
											class="mx-auto"
											variant="ghost"
											aria-label="Play German pronunciation"
											onclick={() => speak(germanTerm(active))}
											><Volume2Icon class="size-5" />Listen</Button
										>{/if}
								{/if}
								<Button
									class="mx-auto mt-auto w-full max-w-sm"
									variant="outline"
									size="lg"
									onclick={() => {
										revealed = true;
									}}>Show answer</Button
								>
							{/if}
						</div>
						<div
							class="lingvo-surface card-face card-back p-6 sm:p-9"
							inert={!revealed}
							aria-hidden={!revealed}
						>
							<div class="mb-6 flex items-center justify-between">
								<p class="lingvo-eyebrow">
									{kind === 'phrase' ? 'The phrase' : 'Turn it into a memory'}
								</p>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Play German pronunciation"
									onclick={() => speak(germanTerm(active))}><Volume2Icon class="size-5" /></Button
								>
							</div>
							<CardDefinition card={active} nativeLanguage={dictionary.nativeLanguage} />
							{#if correct !== null}<p
									class={`mt-5 rounded-xl p-3 text-sm ${correct ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}
								>
									{#if correct}<CheckIcon class="mr-1 inline size-4" />{hinted
											? 'You got it with a hint.'
											: 'That is right.'}{:else}Compare the phrase with your answer. A little
										practice will help it stick.{/if}
								</p>{/if}
							<p class="mt-6 text-xs text-muted-foreground">
								{kind === 'word'
									? 'How well did you remember? Swipe left to repeat, right if you knew it.'
									: 'How easily did you recall the phrase?'}
							</p>
						</div>
					</div>
				</div>
				<div
					bind:this={recall}
					class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
					role="group"
					aria-label="Rate your recall"
				>
					{#each ratings as rating (rating.value)}
						<Button
							variant={rating.value === 3 ? 'default' : 'outline'}
							class={`h-auto min-h-16 flex-col gap-1 py-3 ${rating.value === 1 ? 'border-destructive/25 text-destructive' : ''}`}
							disabled={!revealed || busy || !!pending}
							onclick={() => void save(rating.value)}
							aria-label={rating.label + (intervals ? ' · ' + intervals[rating.value] : '')}
						>
							<span class="font-semibold">{rating.label}</span><span class="text-xs"
								>{revealed && intervals ? intervals[rating.value] : rating.hint}</span
							>
						</Button>
					{/each}
				</div>
				<div
					class="mt-3 flex min-h-6 items-center justify-center gap-2 text-xs text-muted-foreground"
					role="status"
				>
					{#if busy}<LoaderCircleIcon class="size-3.5 motion-safe:animate-spin" />Saving your
						progress…{:else}Space to reveal · 1–4 to rate · ← Again · → Good{/if}
				</div>
			</div>
		{/key}
	{:else if study.isPending || study.isFetching || busy}
		<div
			class="lingvo-surface grid min-h-80 place-items-center text-muted-foreground"
			role="status"
		>
			Preparing your next cards…
		</div>
	{:else if study.isError}
		<div class="lingvo-surface p-8">
			<p role="alert" class="text-sm text-destructive">{errorMessage(study.error)}</p>
			<Button class="mt-4" variant="outline" onclick={() => void study.refetch()}>Try again</Button>
		</div>
	{:else}
		<div
			class="lingvo-surface completion flex min-h-96 flex-col items-center justify-center p-8 text-center"
		>
			<span
				class="mb-5 grid size-20 place-items-center rounded-3xl bg-accent text-accent-foreground"
				><SparklesIcon class="size-9" /></span
			>
			<p class="lingvo-eyebrow">{completed ? 'A little further than before' : 'Your own pace'}</p>
			<h2 class="mt-3 text-3xl font-bold tracking-tight">
				{completed
					? 'Good work for today.'
					: counts?.total
						? 'You are all caught up.'
						: 'Find your first ' + (kind === 'word' ? 'words.' : 'phrases.')}
			</h2>
			<p class="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
				{completed
					? `You completed ${completed}${completed === 1 ? ' review.' : ' reviews.'}` +
						' Your next cards will appear when they are due.'
					: counts?.total
						? 'Add a few new cards from the library or return when your next review is ready.'
						: 'Choose a starter set from the library or add a few cards of your own.'}
			</p>
			{#if nextDue}<p class="mt-3 text-xs text-muted-foreground">
					Next review: {dueDate(nextDue)}
				</p>{/if}
			<div class="mt-6 flex flex-wrap justify-center gap-2">
				<Button onclick={onLibrary}><LayersIcon class="size-4" />Explore the library</Button><Button
					variant="outline"
					onclick={onExit}>Back to progress</Button
				>
			</div>
		</div>
	{/if}
	{#if error}
		<div class="mt-4 rounded-2xl border border-destructive/30 bg-card p-4">
			<p role="alert" class="text-sm text-destructive">{error}</p>
			<div class="mt-3 flex gap-2">
				{#if pending}<Button variant="outline" size="sm" disabled={busy} onclick={() => void save()}
						>Retry this answer</Button
					>{/if}<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onclick={() => void progress.refresh()}>Refresh saved progress</Button
				>
			</div>
		</div>
	{/if}
	<p class="mt-5 text-center text-xs leading-5 text-muted-foreground">
		Your answers help schedule the next review at the right time for you.
	</p>
</section>

<style>
	.card-front:focus-visible {
		outline: 2px solid var(--focus-color);
		outline-offset: 3px;
	}
	.card-scene {
		position: relative;
		perspective: 1400px;
		touch-action: pan-y;
		transition: transform 0.15s ease-out;
	}
	.card-turner {
		display: grid;
		transform-style: preserve-3d;
		transition: transform 0.4s cubic-bezier(0.22, 0.8, 0.26, 1);
	}
	.card-turner.turned {
		transform: rotateY(180deg);
	}
	.card-face {
		grid-area: 1 / 1;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		min-height: 340px;
		max-height: 70dvh;
		overflow-y: auto;
	}
	.card-front {
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.card-back {
		transform: rotateY(180deg);
	}
	.swipe-label {
		position: absolute;
		z-index: 2;
		top: 1rem;
		right: 1rem;
		border-radius: 0.75rem;
		padding: 0.5rem 1rem;
		background: var(--accent);
		color: var(--accent-foreground);
		font-weight: 700;
		transform: rotate(-8deg);
	}
	.swipe-label.forgot {
		left: 1rem;
		right: auto;
		background: var(--muted);
		color: var(--destructive);
		transform: rotate(8deg);
	}
	.completion {
		background:
			radial-gradient(
				ellipse at 50% 0%,
				color-mix(in oklch, var(--accent), transparent 35%),
				transparent 60%
			),
			var(--card);
	}
	@media (max-width: 639px) {
		.card-face {
			min-height: 330px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card-turner,
		.card-scene {
			transition: none;
		}
	}
</style>
