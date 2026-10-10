<script lang="ts">
	// Composes the popover primitive with the shared Rhea styling
	import { Popover as PopoverPrimitive } from 'bits-ui';

	let { ...restProps }: PopoverPrimitive.PortalProps = $props();
</script>

<PopoverPrimitive.Portal {...restProps} />
