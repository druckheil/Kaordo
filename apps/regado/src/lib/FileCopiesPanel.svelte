<script lang="ts">
	// Presents measured file-copy states and explains background checks and repairs
	import type { AdminMount, AdminSystem } from "@kaordo/contracts";
	import ContextHelp from "./ContextHelp.svelte";
 import OperationProgress from "./OperationProgress.svelte";
 import { Button } from "@kaordo/ui";
	import { fileCopySummary, formatBytes as bytes, formatDateTime as time } from "./regado-model";
	let { system, pool, actionBusy, onCheck, onRepair }: {
		system: AdminSystem | null; pool: AdminMount; actionBusy: boolean;
		onCheck: (path: string) => void; onRepair: (path: string) => void;
	} = $props();
	const report = $derived(system?.replicationReports?.find((item) => item.path === pool.path));
	const summary = $derived(fileCopySummary(system, pool));
	const media = $derived(system?.mediaMaintenance);
	const busy = $derived(actionBusy || report?.state === "checking" || report?.state === "repairing" || media?.state === "checking" || media?.state === "repairing");
	const rows = $derived([
		{ key: "duplicated", label: "Duplicated", count: summary?.duplicated, description: "Two copies on separate disks", classes: "bg-primary-soft text-primary-soft-foreground" },
		{ key: "single", label: "Single copy", count: summary?.single, description: "Needs a second available copy", classes: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
		{ key: "surplus", label: "Surplus", count: summary?.surplus, description: "Expired uploads with no references", classes: "bg-destructive/10 text-destructive" },
		{ key: "unverified", label: "Unverified", count: summary?.unverified, description: "Insufficient evidence to classify", classes: "bg-secondary text-secondary-foreground" },
	]);
	function percent(count: number | undefined): string {
		if (!summary || count === undefined) return "—";
		return `${summary.total > 0 ? (100 * count / summary.total).toFixed(1) : "0.0"}%`;
	}
	const stage = $derived(report?.stage === "replication" ? "Restoring two-copy allocation…" : report?.stage === "checksums" ? "Scanning disk checksums…" : "Counting stored files…");
</script>

<section class="mt-4 rounded-2xl border border-border bg-background p-5" aria-label={`File copies in ${pool.path}`}>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="flex items-center gap-1"><h4 class="font-semibold">File copies</h4><ContextHelp label="file copies"><p>Percentages count regular files in this pool, not disk capacity.</p><p>Check copies scans checksummed data and metadata on all disks, counts files and verifies expired upload references. It deletes nothing.</p><p>Repair restores two-copy placement, repairs corrupt blocks from valid copies and removes only unreferenced uploads older than 24 hours. Missing replicas never justify deleting surviving data.</p><p>Mixed profiles and unavailable evidence stay unverified. Files created without checksums cannot have their contents verified by scrub.</p><p>Progress percentages refer to the measured current phase. Later phases can have different totals.</p></ContextHelp></div>
		<div class="flex flex-wrap gap-2">
			<Button size="sm" variant="outline" disabled={busy || !system} onclick={() => onCheck(pool.path)}>Check copies</Button>
			<Button size="sm" disabled={busy || !summary || !media || (pool.integrity?.devicesOnline ?? 0) < 2 || pool.integrity?.devicesOnline !== pool.integrity?.devicesExpected || pool.integrity?.balanceRunning} onclick={() => onRepair(pool.path)}>Repair and clean up</Button>
		</div>
	</div>
	<div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
		{#each rows as row (row.key)}
			<div class={`rounded-xl px-4 py-3 ${row.classes}`}>
				<p class="text-xs font-semibold">{row.label}</p><p class="mt-1 text-2xl font-bold tabular-nums">{percent(row.count)}</p>
				<p class="mt-1 text-xs">{row.count === undefined ? "Not checked" : `${row.count.toLocaleString()} files`}</p>

			</div>
		{/each}
	</div>
 {#if report?.state === "checking" || report?.state === "repairing"}<div class="mt-4"><OperationProgress label={stage} progress={report.progress} /></div>{/if}
 {#if media?.state === "checking" || media?.state === "repairing"}<div class="mt-3"><OperationProgress label={media.stage === "references" ? "Verifying upload references" : "Scanning media inventory"} progress={media.progress} /></div>{/if}
	{#if summary}
		<p class="mt-3 text-xs text-muted-foreground">{summary.total.toLocaleString()} regular files · {bytes(summary.report.bytes)} logical file size · checked {time(summary.report.checkedAt)}</p>
		{#if summary.report.unreadable > 0}<p class="mt-2 text-sm text-destructive">{summary.report.unreadable} paths could not be read. Their files are not included in these percentages.</p>{/if}
	{/if}
	{#if report?.error}<p class="mt-3 text-sm text-destructive" role="alert">{report.error}</p>{/if}
	{#if media?.error}<p class="mt-2 text-sm text-destructive" role="alert">{media.error}</p>{/if}
	{#if (media?.missingFiles ?? 0) > 0}<p class="mt-2 text-sm text-destructive">{media?.missingFiles} expected media files are missing. A surviving copy is kept; missing data is never treated as surplus.</p>{/if}
	{#if (media?.removedFiles ?? 0) > 0}<p class="mt-2 text-xs text-muted-foreground">Last cleanup removed {media?.removedFiles} expired files ({bytes(media?.removedBytes)} logical size).</p>{/if}
</section>
