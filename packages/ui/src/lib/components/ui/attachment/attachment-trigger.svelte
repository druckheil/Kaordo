<script lang="ts">
	// Shares trigger props with a caller-provided child or a default button
	import { cn, type WithElementRef } from '../../../utils.js';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		type = 'button',
		child,
		...restProps
	}: WithElementRef<HTMLButtonAttributes> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	const triggerProps = $derived({
		class: cn('absolute inset-0 z-10 outline-none', className),
		'data-slot': 'attachment-trigger',
		...restProps
	});
</script>

{#if child}
	{@render child({ props: triggerProps })}
{:else}
	<button bind:this={ref} {type} {...triggerProps}>
		{@render triggerProps.children?.()}
	</button>
{/if}
