<script lang="ts">
	// Renders a native button or link with shared Rhea variants
	import { cn } from '../../../utils.js';
	import { buttonVariants, type ButtonProps } from './button-variants.js';
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();

	const buttonClass = $derived(cn(buttonVariants({ variant, size }), className));
	const disabledLink = $derived(Boolean(href && disabled));
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={buttonClass}
		href={disabledLink ? undefined : href}
		aria-disabled={disabled}
		role={disabledLink ? 'link' : undefined}
		tabindex={disabledLink ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button bind:this={ref} data-slot="button" class={buttonClass} {type} {disabled} {...restProps}>
		{@render children?.()}
	</button>
{/if}
