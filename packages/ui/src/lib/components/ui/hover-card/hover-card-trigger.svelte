<script lang="ts">
	// Composes the hover card primitive with the shared Rhea styling
	import { LinkPreview as HoverCardPrimitive } from 'bits-ui';

	let { ref = $bindable(null), ...restProps }: HoverCardPrimitive.TriggerProps = $props();
</script>

<HoverCardPrimitive.Trigger bind:ref data-slot="hover-card-trigger" {...restProps} />
