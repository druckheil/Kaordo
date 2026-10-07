<script lang="ts">
	// Styles the Rhea radio control while Bits UI owns selection and keyboard behavior
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import CircleIcon from '@lucide/svelte/icons/circle';
	import { cn, type WithoutChildrenOrChild } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
	bind:ref
	data-slot="radio-group-item"
	class={cn(
		"group/radio-group-item peer relative flex size-4 aspect-square shrink-0 rounded-full border border-[var(--control-border)] outline-none after:absolute after:-inset-x-3 after:-inset-y-2",
		"bg-card data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
		"focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-3 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:border-transparent",
		"aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:ring-3 dark:aria-invalid:ring-destructive/40 dark:aria-invalid:border-destructive/50 disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		<div
			data-slot="radio-group-indicator" aria-hidden="true"
			class="absolute inset-0 flex items-center justify-center transition-[opacity,scale] duration-200 motion-reduce:transition-none"
			class:opacity-0={!checked} class:scale-50={!checked}
		>
			<CircleIcon class="size-2 rounded-full bg-primary-foreground dark:size-2.5" />
		</div>
	{/snippet}
</RadioGroupPrimitive.Item>
