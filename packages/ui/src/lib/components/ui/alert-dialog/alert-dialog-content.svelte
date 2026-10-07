<script lang="ts">
	// Keeps confirmation dialogs reachable within the visual viewport
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import { cn, type WithoutChild, type WithoutChildrenOrChild } from "../../../utils.js";
	import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
	import AlertDialogPortal from "./alert-dialog-portal.svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		size = "default",
		portalProps,
		...restProps
	}: WithoutChild<AlertDialogPrimitive.ContentProps> & {
		size?: "default" | "sm";
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>;
	} = $props();
</script>

<AlertDialogPortal {...portalProps}>
	<AlertDialogOverlay />
	<AlertDialogPrimitive.Content
		bind:ref
		data-slot="alert-dialog-content"
		data-size={size}
		class={cn(
			"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 gap-6 rounded-[min(var(--radius-4xl),24px)] p-5 sm:p-6 shadow-xl ring-1 duration-100 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md data-[size=sm]:sm:max-w-xs group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 outline-none",
			className
		)}
		{...restProps}
	/>
</AlertDialogPortal>
