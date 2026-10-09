<script lang="ts">
	// Composes native selection with shared Rhea styling
	import type { ToggleGroupVariants } from './toggle-group-variants.js';
	import { setToggleGroupContext } from './toggle-group-context.js';
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
	import { cn } from '../../../utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = 'default',
		spacing = 0,
		orientation = 'horizontal',
		variant = 'default',
		...restProps
	}: ToggleGroupPrimitive.RootProps &
		ToggleGroupVariants & {
			spacing?: number;
		} = $props();

	setToggleGroupContext({
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
		get spacing() {
			return spacing;
		}
	});
</script>

<!--
Bits UI distinguishes single and multiple values; the binding preserves that
runtime contract across the destructured prop union
-->
<ToggleGroupPrimitive.Root
	bind:value={value as never}
	bind:ref
	{orientation}
	data-slot="toggle-group"
	data-variant={variant}
	data-size={size}
	data-spacing={spacing}
	style={`--gap: ${spacing}`}
	class={cn(
		'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-[spacing=0]:data-[variant=outline]:rounded-2xl data-vertical:flex-col data-vertical:items-stretch',
		className
	)}
	{...restProps}
/>
