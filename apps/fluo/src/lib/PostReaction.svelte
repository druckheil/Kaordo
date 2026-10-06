<script lang="ts">
	// Owns Fluo reaction selection and heart-to-X motion with native menu controls

	import type { FluoPost } from '@kaordo/contracts';
	import { prefersReducedMotion } from 'svelte/motion';
	import { Button, ChevronDownIcon, DropdownMenu, HeartIcon, XIcon } from '@kaordo/ui';
	import type { FluoPostActionHandlers } from './post-actions';

	let { post, onReact }: {
		post: FluoPost;
		onReact: (value: FluoPost['myReaction']) => ReturnType<FluoPostActionHandlers['react']>;
	} = $props();

	const reactions = {
		good: { value: 'good', label: 'Like', icon: HeartIcon, iconClass: 'size-5', iconProps: {} },
		bad: { value: 'bad', label: 'Dislike', icon: XIcon, iconClass: 'size-6', iconProps: { strokeWidth: 4, 'stroke-linecap': 'square' } },
	} as const;
	const choices = Object.values(reactions);
	let reacting = $state(false);
	let animation = $state<FluoPost['myReaction']>(null);
	const reaction = $derived(post.myReaction);
	const selectedReaction = $derived(reactions[reaction ?? 'good']);
	const count = $derived(post.counts[selectedReaction.value]);

	$effect(() => {
		if (prefersReducedMotion.current) animation = null;
	});

	async function chooseReaction(value: FluoPost['myReaction']): Promise<void> {
		if (reacting || value === post.myReaction) return;
		reacting = true;
		animation = prefersReducedMotion.current ? null : value;
		try {
			const confirmed = await onReact(value);
			if (!confirmed || confirmed.myReaction !== value) animation = null;
		} finally {
			reacting = false;
		}
	}

	function chooseFromMenu(value: string): void {
		if (value === 'good' || value === 'bad') void chooseReaction(value);
	}
</script>

<div
	class="reaction-control pointer-events-auto flex h-11 min-w-22 flex-[1.5] rounded-xl border border-transparent [--reaction-like:var(--color-red-600)] dark:[--reaction-like:var(--color-red-400)]"
	data-reaction={reaction ?? 'none'}
	role="group" aria-label="Reactions" aria-busy={reacting}
>
	<Button
		class="reaction-primary h-full min-w-0 flex-1 gap-1 rounded-r-none px-1 disabled:opacity-100 sm:gap-2 sm:px-2"
		variant="ghost" size="sm"
		aria-label={`${selectedReaction.label}, ${count}`}
		aria-pressed={reaction !== null}
		title={reaction ? `Remove ${selectedReaction.label.toLowerCase()}` : 'Like this post'}
		disabled={reacting}
		onclick={() => void chooseReaction(reaction ? null : 'good')}
	>
		<span
			class="reaction-glyph relative size-5 shrink-0"
			data-reaction={reaction ?? 'none'} data-animation={reaction === animation ? animation : null}
			aria-hidden="true"
			onanimationend={(event) => {
				if (event.target === event.currentTarget && !event.pseudoElement) animation = null;
			}}
		>
			{#each choices as option (option.value)}
				{@const Icon = option.icon}
				<Icon
					{...option.iconProps} data-reaction-icon={option.value}
					class={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${option.iconClass}`}
				/>
			{/each}
		</span>
		<span class="min-w-0 truncate text-xs tabular-nums sm:text-sm">{count}</span>
	</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					class="reaction-menu relative h-full w-8 shrink-0 rounded-l-none px-0 text-muted-foreground sm:w-7"
					variant="ghost" size="sm"
					aria-label="Reaction options" title="Choose a reaction"
				>
					<ChevronDownIcon class="size-3.5 transition-transform duration-200 group-aria-expanded/button:rotate-180 motion-reduce:transition-none" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="center" sideOffset={6} class="w-48">
			<DropdownMenu.Label>Reactions</DropdownMenu.Label>
			<DropdownMenu.RadioGroup bind:value={() => reaction ?? 'none', chooseFromMenu}>
				{#each choices as option (option.value)}
					{@const Icon = option.icon}
					<DropdownMenu.RadioItem
						value={option.value} closeOnSelect disabled={reacting}
						class="min-h-11" aria-label={`${option.label}, ${post.counts[option.value]}`}
					>
						<span class="grid size-5 shrink-0 place-items-center">
							<Icon
								{...option.iconProps}
								class={`${option.iconClass} ${option.value === 'good' ? 'text-red-600 dark:text-red-400' : ''}`}
								fill={option.value === 'good' && reaction === 'good' ? 'currentColor' : 'none'}
							/>
						</span>
						<span class="flex-1">{option.label}</span><span class="text-xs tabular-nums text-muted-foreground">{post.counts[option.value]}</span>
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
			{#if reaction}
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="min-h-11 text-muted-foreground" disabled={reacting} onSelect={() => void chooseReaction(null)}>
					Remove reaction
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>

<style>
	.reaction-control {
		transition: background-color 180ms ease, border-color 180ms ease;
	}
	.reaction-control:hover,
	.reaction-control:focus-within { border-color: var(--border); }
	.reaction-control[data-reaction='good'] {
		border-color: color-mix(in oklab, var(--reaction-like) 18%, transparent);
		background: color-mix(in oklab, var(--reaction-like) 6%, transparent);
	}
	.reaction-control[data-reaction='good'] :global(.reaction-primary),
	.reaction-control:not([data-reaction='bad']) :global(.reaction-primary:hover) {
		color: var(--reaction-like);
	}
	.reaction-control:not([data-reaction='bad']) :global(.reaction-primary:hover) {
		background: color-mix(in oklab, var(--reaction-like) 10%, transparent);
	}
	.reaction-control[data-reaction='bad'] {
		border-color: var(--border);
		background: var(--muted);
	}
	.reaction-control :global(.reaction-menu::before) {
		content: '';
		position: absolute;
		left: 0;
		top: 30%;
		bottom: 30%;
		width: 1px;
		background: var(--border);
	}
	.reaction-glyph :global(svg) { transition: opacity 140ms ease, transform 180ms ease, fill 180ms ease; }
	.reaction-glyph :global([data-reaction-icon='good']) { fill: transparent; }
	.reaction-glyph :global([data-reaction-icon='bad']) { opacity: 0; transform: scale(.55); }
	.reaction-glyph[data-reaction='good'] :global([data-reaction-icon='good']) { fill: currentColor; }
	.reaction-glyph[data-reaction='bad'] :global([data-reaction-icon='good']) { opacity: 0; transform: scale(.55); }
	.reaction-glyph[data-reaction='bad'] :global([data-reaction-icon='bad']) { opacity: 1; transform: scale(1); }
	.reaction-glyph[data-animation='good'] { animation: heart-pulse 580ms ease; }
	.reaction-glyph[data-animation='good']::after {
		content: '';
		position: absolute;
		inset: -5px;
		border: 1.5px solid currentColor;
		border-radius: 50%;
		pointer-events: none;
		animation: heart-ripple 580ms ease-out forwards;
	}
	.reaction-glyph[data-animation='bad'] { animation: reaction-turn 660ms linear; }
	.reaction-glyph[data-animation='bad'] :global(svg) { transition-delay: 130ms; }

	@keyframes heart-pulse {
		0%, 100% { transform: scale(1); }
		25% { transform: scale(1.28); }
		45% { transform: scale(.92); }
		65% { transform: scale(1.08); }
	}
	@keyframes heart-ripple {
		0% { transform: scale(.6); opacity: .5; }
		100% { transform: scale(1.65); opacity: 0; }
	}
	@keyframes reaction-turn {
		0% { transform: rotate(0deg) scale(1); }
		30% { transform: rotate(285deg) scale(.68); }
		65% { transform: rotate(354deg) scale(1.18); }
		82% { transform: rotate(363deg) scale(.95); }
		100% { transform: rotate(360deg) scale(1); }
	}
	@media (prefers-reduced-motion: reduce) {
		.reaction-control,
		.reaction-glyph :global(svg) { transition: none; }
		.reaction-glyph[data-animation] { animation: none; }
		.reaction-glyph::after { display: none; }
	}
</style>
