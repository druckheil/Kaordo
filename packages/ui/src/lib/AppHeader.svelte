<script lang="ts">
	// Provides the shared Kaordo header and accessible app navigation
	import { getContext, type Snippet } from 'svelte';
	import { headerActionsContext, type HeaderActions } from './header-actions.js';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { Button } from './components/ui/button/index.js';
	import ThemeToggle from './ThemeToggle.svelte';
	import AgordojLink from './AgordojLink.svelte';

	interface Props {
		name: string;
		homeHref: string;
		sticky?: boolean;
		wide?: boolean;
		settingsActive?: boolean;
		backAction?: (() => void) | null;
		actions?: Snippet;
		showAllApps?: boolean;
	}

	let {
		name,
		homeHref,
		sticky = false,
		wide = false,
		settingsActive = false,
		backAction = null,
		actions,
		showAllApps = true
	}: Props = $props();
	const contextualActions = getContext<HeaderActions>(headerActionsContext);
	const accountActions = $derived(contextualActions?.());

	const headerClass = $derived(
		`shrink-0 border-b border-border/80 bg-background/95 backdrop-blur-xl ${sticky ? 'sticky top-0 z-20' : ''}`
	);
	const contentClass = $derived(
		`mx-auto min-h-12 flex flex-wrap items-center px-4 py-1 sm:px-6 ${
			backAction
				? 'justify-between gap-3 xl:grid xl:grid-cols-[14rem_minmax(0,1fr)_auto] xl:gap-10'
				: 'justify-between gap-3'
		} ${wide ? 'max-w-[90rem]' : 'max-w-6xl'}`
	);
</script>

<a
	href="#main-content"
	class="sr-only fixed top-3 left-3 z-50 rounded-xl bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only focus:outline-none"
>
	Skip to main content
</a>
<header class={headerClass}>
	<div class={contentClass}>
		<div class="flex max-w-full min-w-0 items-center gap-2.5">
			<a
				href={homeHref}
				rel="external"
				aria-label="Kaordo home"
				data-slot="app-home"
				class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				K
			</a>
			<span class="hidden text-sm font-bold tracking-tight text-link min-[390px]:inline">
				Kaordo
			</span>
			{#if name}
				<span class="text-muted-foreground/60" aria-hidden="true">/</span>
				<span class="truncate text-base font-bold tracking-tight">{name}</span>
			{/if}
		</div>
		{#if backAction}
			<Button
				variant="ghost"
				size="sm"
				class="ml-12 hidden justify-self-start whitespace-nowrap xl:inline-flex"
				aria-label="Back"
				title="Back"
				onclick={backAction}
			>
				<ChevronLeftIcon class="size-4" />
				<span class="hidden min-[390px]:inline">Back</span>
			</Button>
		{/if}
		<div
			class={`flex shrink-0 items-center gap-1 sm:gap-2 ${backAction ? 'col-start-2 row-start-1 xl:col-start-3' : ''}`}
		>
			{@render accountActions?.()}
			{@render actions?.()}
			{#if showAllApps}
				<Button
					href={homeHref}
					rel="external"
					variant="ghost"
					size="sm"
					class="shrink-0"
					aria-label="All apps"
				>
					<span class="hidden sm:inline">All apps</span>
					<ArrowUpRightIcon class="size-4" />
				</Button>
			{/if}
			<ThemeToggle />
			<AgordojLink current={settingsActive} />
		</div>
	</div>
</header>
