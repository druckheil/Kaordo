<script lang="ts">
	// Composes the native slider with shared Rhea styling and accessible thumb labels
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "../../../utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		class: className,
		thumbLabel,
		...restProps
	}: WithoutChildrenOrChild<SliderPrimitive.RootProps> & { thumbLabel?: string } = $props();
</script>

<!--
Preserves the single/multiple value union across the bindable props
-->
<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	{orientation}
	class={cn(
		"data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col",
		className
	)}
	{...restProps}
>
	{#snippet children({ thumbItems })}
		<span
			data-slot="slider-track"
			data-orientation={orientation}
			class="bg-[var(--control-border)] rounded-2xl data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1 relative grow overflow-hidden"
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				class="bg-primary absolute select-none data-horizontal:h-full data-vertical:w-full"
			/>
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				index={thumb.index}
				aria-label={thumbLabel}
				class="size-6 min-h-[24px] min-w-[24px] rounded-full border-2 border-link bg-card shadow-sm transition-[color,box-shadow] duration-200 hover:ring-4 hover:ring-ring/20 focus-visible:ring-4 focus-visible:ring-ring/20 block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
