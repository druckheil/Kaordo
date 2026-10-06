<script lang="ts">
 // Composes the popover primitive with the shared Rhea styling
	import { Popover as PopoverPrimitive } from "bits-ui";

	let { open = $bindable(false), ...restProps }: PopoverPrimitive.RootProps = $props();
</script>

<PopoverPrimitive.Root bind:open {...restProps} />
