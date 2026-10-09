<script lang="ts">
	// Presents due cards, daily goals and server-owned study activity for each language pair
	import type { LingvoOverview } from '@kaordo/contracts';
	import {
		BookOpenIcon,
		Button,
		FlameIcon,
		LayersIcon,
		MessageCircleIcon,
		Progress,
		SparklesIcon,
		TargetIcon
	} from '@kaordo/ui';
	import { dueDate, type CardKind } from './lingvo-context';

	let {
		overview,
		kind,
		onStudy,
		onLibrary,
		onPreferences
	}: {
		overview: LingvoOverview;
		kind: CardKind;
		onStudy(this: void, kind: CardKind): void;
		onLibrary(this: void): void;
		onPreferences(this: void): void;
	} = $props();
	const counts = $derived(overview.counts.find((item) => item.kind === kind));
	const percentage = $derived(
		Math.min(100, Math.round((overview.studiedToday / overview.dictionary.dailyGoal) * 100))
	);
	const isPhrase = $derived(kind === 'phrase');
	const activity = $derived.by(() => {
		const today = Date.parse(overview.today + 'T12:00:00Z');
		return Array.from({ length: 14 }, (_, index) => {
			const day = new Date(today + (index - 13) * 86_400_000);
			const key = day.toISOString().slice(0, 10);
			return {
				key,
				reviews: overview.activity.find((item) => item.day === key)?.reviews ?? 0,
				label: new Intl.DateTimeFormat('en', {
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC'
				}).format(day)
			};
		});
	});
	const activityMax = $derived(
		Math.max(overview.dictionary.dailyGoal, ...activity.map((day) => day.reviews))
	);
</script>

<section
	class="grid gap-5 lg:grid-cols-[1.6fr_1fr]"
	aria-label={isPhrase ? 'Phrase learning' : 'Word learning'}
>
	<div
		class="lingvo-surface hero relative isolate flex min-h-80 flex-col justify-center overflow-hidden p-6 sm:p-9"
	>
		<div class="relative z-10 max-w-sm">
			<p class="lingvo-eyebrow text-link">
				{isPhrase ? 'From words to conversation' : 'A little German, every day'}
			</p>
			<h1 class="mt-3 text-3xl font-bold tracking-[-0.045em] sm:text-4xl">
				{isPhrase ? 'Find your words.' : 'Make it stick.'}
			</h1>
			<p class="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
				{isPhrase
					? 'Arrange words into everyday phrases. Build confidence in German word order, then try writing from memory.'
					: 'Listen, turn the card and recall the meaning. Each answer helps space your next review.'}
			</p>
			<div class="mt-6 flex flex-wrap gap-2">
				{#if counts?.total}
					<Button size="lg" onclick={() => onStudy(kind)}
						><SparklesIcon class="size-4" />{counts.due
							? isPhrase
								? 'Practice phrases'
								: 'Start learning'
							: 'Open practice'}{#if counts.due}<span
								class="ml-1 rounded-md bg-primary-foreground/15 px-2 py-0.5 text-xs"
								>{counts.due}</span
							>{/if}</Button
					>
				{:else}
					<Button size="lg" onclick={onLibrary}
						><LayersIcon class="size-4" />Find your first cards</Button
					>
				{/if}
			</div>
			{#if counts?.total && !counts.due && counts.nextDue}<p
					class="mt-4 text-xs text-muted-foreground"
				>
					Next review: {dueDate(counts.nextDue)}
				</p>{/if}
		</div>
		<div
			class="sample-card pointer-events-none absolute top-12 right-7 hidden w-40 rounded-2xl border border-border bg-card p-5 shadow-xl xl:block"
			aria-hidden="true"
		>
			<span class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase"
				>{isPhrase ? 'A little conversation' : 'A word to remember'}</span
			>
			<p class="my-7 text-lg font-bold" lang="de">
				{#if isPhrase}Schön, dich kennenzulernen!{:else}<span
						class="german-article mr-1"
						data-article="das">das</span
					>Buch{/if}
			</p>
			<div class="h-px bg-border"></div>
			<p class="mt-3 text-xs text-muted-foreground">
				{isPhrase
					? overview.dictionary.nativeLanguage === 'ru'
						? 'Приятно познакомиться!'
						: 'Nice to meet you!'
					: overview.dictionary.nativeLanguage === 'ru'
						? 'книга'
						: 'book'}
			</p>
		</div>
	</div>
	<div class="lingvo-surface flex flex-col justify-center p-6 sm:p-7">
		<div class="flex items-start justify-between gap-4">
			<div>
				<p class="lingvo-eyebrow">Today's intention</p>
				<h2 class="mt-2 text-xl font-bold">A little goes a long way.</h2>
			</div>
			<span
				class="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground"
				><TargetIcon class="size-5" /></span
			>
		</div>
		<p class="mt-6 text-4xl font-bold tracking-tight">
			{overview.studiedToday}<span class="text-lg font-normal text-muted-foreground">
				/ {overview.dictionary.dailyGoal}</span
			>
		</p>
		<p class="mt-1 text-sm text-muted-foreground">Reviews today across words and phrases</p>
		<Progress class="mt-4 h-2.5" value={percentage} aria-label="Daily review goal" />
		<div class="mt-4 flex items-center justify-between gap-3">
			<p class="text-xs text-muted-foreground">
				{percentage === 100 ? 'Daily goal reached. Nicely done.' : 'Small steps add up.'}
			</p>
			<Button variant="ghost" size="xs" onclick={onPreferences}>Adjust goal</Button>
		</div>
	</div>
</section>

<section class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Dictionary progress">
	{#each [{ label: 'Ready to review', value: counts?.due ?? 0, help: 'Due and new cards' }, { label: 'Learning', value: counts?.learning ?? 0, help: 'Building familiarity' }, { label: 'In review', value: counts?.review ?? 0, help: 'Ready again later' }, { label: 'Already known', value: counts?.known ?? 0, help: 'Outside the review queue' }] as stat (stat.label)}
		<div class="lingvo-surface rounded-2xl p-4 sm:p-5">
			<p class="text-xs font-medium text-muted-foreground">{stat.label}</p>
			<p class="mt-2 text-3xl font-bold tracking-tight">{stat.value}</p>
			<p class="mt-1 text-xs text-muted-foreground">{stat.help}</p>
		</div>
	{/each}
</section>

<section class="mt-5 grid gap-5 md:grid-cols-[1.2fr_1fr]">
	<div class="lingvo-surface p-6">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="lingvo-eyebrow">Keep coming back</p>
				<h2 class="mt-2 text-lg font-bold">Your last two weeks</h2>
			</div>
			<span
				class="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground"
				><FlameIcon class="size-4" />{overview.streak}
				{overview.streak === 1 ? 'day' : 'days'}</span
			>
		</div>
		<div
			class="mt-6 flex h-24 items-end gap-1.5"
			role="img"
			aria-label={activity.map((day) => `${day.label}: ${day.reviews} reviews`).join('; ')}
		>
			{#each activity as day (day.key)}
				<div
					class="flex h-full min-w-0 flex-1 items-end"
					title={`${day.label} · ${day.reviews} reviews`}
				>
					<div
						class="activity-bar w-full rounded-t-lg bg-primary/70"
						class:empty={!day.reviews}
						style:height={`${Math.max(7, (day.reviews / activityMax) * 100)}%`}
					></div>
				</div>
			{/each}
		</div>
		<div class="mt-2 flex justify-between text-[11px] text-muted-foreground">
			<span>{activity[0].label}</span><span>Today</span>
		</div>
		<p class="mt-4 text-xs text-muted-foreground">
			{overview.totalReviews} total {overview.totalReviews === 1 ? 'review' : 'reviews'} · Days follow
			your {overview.dictionary.timeZone} time zone.
		</p>
	</div>
	<div class="lingvo-surface flex flex-col justify-center p-6">
		<span class="mb-3 grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground"
			>{#if isPhrase}<BookOpenIcon class="size-5" />{:else}<MessageCircleIcon
					class="size-5"
				/>{/if}</span
		>
		<h2 class="text-lg font-bold">
			{isPhrase ? 'Every phrase starts with words.' : 'Put your words to work.'}
		</h2>
		<p class="mt-2 text-sm leading-6 text-muted-foreground">
			{isPhrase
				? 'Learn articles, plurals and useful verbs one card at a time.'
				: 'Take German beyond individual words with greetings, café orders and everyday conversations.'}
		</p>
		<div class="mt-4">
			<Button variant="outline" onclick={() => onStudy(isPhrase ? 'word' : 'phrase')}
				>{isPhrase ? 'Learn words' : 'Practice phrases'}</Button
			><Button class="ml-1" variant="ghost" onclick={onLibrary}>Browse sets</Button>
		</div>
	</div>
</section>

<style>
	.hero {
		background:
			radial-gradient(
				ellipse at 100% 0%,
				color-mix(in oklch, var(--primary), transparent 91%),
				transparent 65%
			),
			var(--card);
	}
	.sample-card {
		transform: rotate(8deg);
	}
	.activity-bar {
		transition:
			height 0.4s ease,
			background-color 0.2s ease;
	}
	.activity-bar.empty {
		background: var(--muted);
	}
	@media (prefers-reduced-motion: reduce) {
		.sample-card {
			animation: none;
		}
		.activity-bar {
			transition: none;
		}
	}
</style>
