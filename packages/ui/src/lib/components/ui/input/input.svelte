<script lang="ts">
	// Renders typed inputs with shared styling and file-list bindings
	import { cn, type WithElementRef } from "../../../utils.js";
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";

	const inputClasses = [
		"bg-card border-[var(--control-border)] focus-visible:border-ring focus-visible:ring-ring/30",
		"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
		"aria-invalid:border-destructive dark:aria-invalid:border-destructive/50",
		"h-11 rounded-xl border px-3.5 py-2 text-base transition-[color,box-shadow] duration-200",
		"file:h-7 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm",
		"w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground",
		"placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
	].join(" ");

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		"data-slot": dataSlot = "input",
		...restProps
	}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(inputClasses, className)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(inputClasses, className)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
