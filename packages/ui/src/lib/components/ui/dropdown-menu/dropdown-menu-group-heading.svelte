<script lang="ts">
	// Styles the accessible dropdown-menu group heading

	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn } from '../../../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: DropdownMenuPrimitive.GroupHeadingProps & {
		inset?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
	bind:ref
	data-slot="dropdown-menu-group-heading"
	data-inset={inset}
	class={cn('px-2 py-1 text-xs text-muted-foreground data-inset:pl-7', className)}
	{...restProps}
/>
