<script lang="ts">
	// Prepares shared bubble content props for elements and child snippets
	import { cn, type WithElementRef } from "../../../utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		child,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	const contentProps = $derived({
		class: cn(
			"rounded-3xl border border-transparent px-3 py-2.5 text-sm leading-relaxed [button,a]:outline-none [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-ring/30 group-data-[align=end]/bubble:self-end w-fit max-w-full min-w-0 overflow-hidden wrap-break-word [button]:text-left [button,a]:transition-colors",
			className
		),
		"data-slot": "bubble-content",
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: contentProps })}
{:else}
	<div bind:this={ref} {...contentProps}>
		{@render contentProps.children?.()}
	</div>
{/if}
