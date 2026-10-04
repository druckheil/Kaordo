<script lang="ts">
 // Composes the popover primitive with the shared Rhea styling
	import { cn, type WithElementRef } from "../../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="popover-description"
	class={cn("text-muted-foreground", className)}
	{...restProps}
>
	{@render children?.()}
</div>
