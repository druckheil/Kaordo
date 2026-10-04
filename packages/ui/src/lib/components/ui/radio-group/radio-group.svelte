<script lang="ts">
	// Composes the Bits UI radio group with shared Rhea layout and binding
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn } from "../../../utils.js";

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: RadioGroupPrimitive.RootProps = $props();
</script>

<RadioGroupPrimitive.Root
	bind:ref
	bind:value
	data-slot="radio-group"
	class={cn("grid gap-3 w-full", className)}
	{...restProps}
/>
