<script lang="ts">
	// Renders attachment actions with the shared button variants
	import Button from '../button/button.svelte';
	import type { ButtonProps } from '../button/button-variants.js';
	import { cn } from '../../../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'ghost',
		size = 'icon-xs',
		...restProps
	}: ButtonProps = $props();
</script>

<Button
	bind:ref
	data-slot="attachment-action"
	{variant}
	{size}
	class={cn(className)}
	{...restProps}
/>
