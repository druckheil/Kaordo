<script lang="ts">
	// Composes the hover card primitive with the shared Rhea styling
	import { LinkPreview as HoverCardPrimitive } from 'bits-ui';

	let { ...restProps }: HoverCardPrimitive.PortalProps = $props();
</script>

<HoverCardPrimitive.Portal {...restProps} />
