<script lang="ts">
	// Shows the latest administrator actions and their recorded reasons

	import type { AdminAuditEntry } from "@kaordo/contracts";
	import { Button } from "@kaordo/ui";
	import { formatDateTime } from "./regado-model";

	let {
		entries,
		loading,
		onRefresh,
	}: {
		entries: AdminAuditEntry[];
		loading: boolean;
		onRefresh: () => void;
	} = $props();
</script>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 class="text-lg font-bold">Admin audit</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				The latest 100 administrator actions. Records are retained in PostgreSQL.
			</p>
		</div>
		<Button variant="outline" onclick={onRefresh} disabled={loading}>Refresh</Button>
	</div>
	<div class="mt-5 divide-y divide-border">
		{#each entries as entry (entry.id)}
			<div class="grid gap-1 py-4 text-sm sm:grid-cols-[11rem_1fr]">
				<time class="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</time>
				<div>
					<p>
						<strong>@{entry.actor}</strong> · {entry.action}{entry.target ? ` · @${entry.target}` : ""}
					</p>
					{#if entry.reason}
						<p class="mt-1 text-xs text-muted-foreground">{entry.reason}</p>
					{/if}
				</div>
			</div>
		{:else}
			<p class="py-8 text-sm text-muted-foreground">No administrator actions recorded yet.</p>
		{/each}
	</div>
</section>
