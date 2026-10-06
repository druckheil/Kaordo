<script lang="ts">
 // Composes the hover card primitive with the shared Rhea styling
	import { LinkPreview as HoverCardPrimitive } from "bits-ui";

	let { open = $bindable(false), ...restProps }: HoverCardPrimitive.RootProps = $props();
</script>

<HoverCardPrimitive.Root bind:open {...restProps} />
