<script lang="ts" module>
	// Defines visual variants for conversation bubbles
	import { tv, type VariantProps } from "tailwind-variants";

	export const bubbleVariants = tv({
		base: [
			"gap-1 data-[align=end]:self-end max-w-[80%] data-[variant=ghost]:max-w-full",
			"group-data-[align=end]/message:self-end group/bubble relative flex w-fit min-w-0 flex-col",
		].join(" "),
		variants: {
			variant: {
				default: [
					"*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:shadow-sm",
				].join(" "),
				secondary: [
					"*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
				].join(" "),
				muted: [
					"*:data-[slot=bubble-content]:bg-muted",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]",
				].join(" "),
				tinted: [
					"*:data-[slot=bubble-content]:bg-primary-soft *:data-[slot=bubble-content]:text-foreground",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:shadow-sm",
				].join(" "),
				outline: [
					"*:data-[slot=bubble-content]:bg-background *:data-[slot=bubble-content]:border-border",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground",
					"dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30",
				].join(" "),
				ghost: [
					"*:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground",
					"dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50 border-none",
				].join(" "),
				destructive: [
					"*:data-[slot=bubble-content]:bg-destructive/10 dark:*:data-[slot=bubble-content]:bg-destructive/20 *:data-[slot=bubble-content]:text-destructive",
					"[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30",
				].join(" "),
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type BubbleVariant = VariantProps<typeof bubbleVariants>["variant"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "../../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		align = "start",
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: BubbleVariant;
		align?: "start" | "end";
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="bubble"
	data-variant={variant}
	data-align={align}
	class={cn(bubbleVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
