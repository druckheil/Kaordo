<script lang="ts">
	// Presents process and scheduled-job health with readable text and consistent status colors
	import type { AdminService } from "@kaordo/contracts";
	import { servicePresentation } from "./system-model";
	let { service }: { service: AdminService } = $props();
	const status = $derived(servicePresentation(service));
	const tones = {
		success: "bg-primary-soft text-primary-soft-foreground",
		warning: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
		danger: "bg-destructive/10 text-destructive",
		neutral: "bg-secondary text-secondary-foreground",
	};
</script>

<span
	class={[
		"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
		tones[status.tone],
	]}
>
	<span class="size-1.5 rounded-full bg-current" aria-hidden="true"
	></span>{status.label}
</span>
