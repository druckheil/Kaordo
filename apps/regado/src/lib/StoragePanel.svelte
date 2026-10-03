<script lang="ts">
	// Displays filesystem, disk health, mirror, and stored-content details

	import type { AdminMetrics, AdminSummary, AdminSystem } from "@kaordo/contracts";
	import { Button } from "@kaordo/ui";
	import MetricChart from "./MetricChart.svelte";
	import { formatBytes as bytes, formatDateTime as time } from "./regado-model";

	let {
		system,
		summary,
		metrics,
		onScrub,
	}: {
		system: AdminSystem | null;
		summary: AdminSummary | null;
		metrics: AdminMetrics | null;
		onScrub: () => void;
	} = $props();

	const mounts = $derived(system?.mounts ?? []);
	const disks = $derived((system?.disks ?? []).filter((disk) => disk.model));
	const mirror = $derived(system?.mirror);

	function mountUsagePercent(used: number, total: number): number {
		return Math.min(100, (used / Math.max(1, total)) * 100);
	}

	function healthColor(state: string): string {
		if (state === "passed") return "text-primary";
		if (state === "failed" || state === "warning") return "text-destructive";
		return "text-muted-foreground";
	}

	function mediaKindLabel(kind: string): string {
		if (kind === "image") return "Photos";
		if (kind === "video") return "Videos";
		return "Files";
	}
</script>

<div class="mt-6 grid gap-4 lg:grid-cols-2">
	{#each mounts as mount}
		{@const usage = mountUsagePercent(mount.used, mount.total)}
		<section class="rounded-[1.4rem] border border-border bg-card p-6">
			<div class="flex justify-between gap-4">
				<div>
					<p class="text-xs font-bold uppercase tracking-widest text-primary">
						{mount.path === "/" ? "NisOS" : "Data1"}
					</p>
					<h2 class="mt-2 font-mono text-sm">{mount.path}</h2>
				</div>
				<p class="text-sm font-bold">{Math.round(usage)}%</p>
			</div>
			<div class="mt-5 h-3 overflow-hidden rounded-full bg-secondary">
				<div class="h-full rounded-full bg-primary" style:width={`${usage}%`}></div>
			</div>
			<p class="mt-3 text-xs text-muted-foreground">
				{bytes(mount.used)} used · {bytes(mount.free)} available · {bytes(mount.total)} total
			</p>
		</section>
	{:else}
		<section class="rounded-[1.4rem] border border-border bg-card p-6 text-sm text-muted-foreground">
			Filesystem information is not available.
		</section>
	{/each}
</div>

<div class="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
	<section class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Physical disks</h2>
		<div class="mt-4 space-y-3">
			{#each disks as disk (disk.path)}
				<article class="rounded-xl bg-secondary/60 p-4">
					<div class="flex items-center justify-between gap-3">
						<strong class="text-sm">{disk.model || disk.name}</strong>
						<span class="text-xs text-muted-foreground">{bytes(disk.size)}</span>
					</div>
					<p class="mt-1 font-mono text-xs text-muted-foreground">{disk.path}</p>

					{#if disk.health}
						<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
							<strong class={healthColor(disk.health.state)}>SMART {disk.health.state}</strong>
							<span>{disk.health.temperatureC ?? "—"} °C</span>
							<span>{disk.health.powerOnHours?.toLocaleString() ?? "—"} hours</span>
						</div>
						<p class="mt-2 text-xs text-muted-foreground">
							Reallocated {disk.health.reallocatedSectors ?? "—"} · Pending
							{disk.health.pendingSectors ?? "—"} · Uncorrectable
							{disk.health.uncorrectableSectors ?? "—"}
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							Checked {time(disk.health.checkedAt)} · Updates every 5 minutes
						</p>
					{/if}

					{#each disk.children ?? [] as partition (partition.path)}
						<div class="mt-2 flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs">
							<span>{partition.label || partition.name} · {partition.fsType || partition.type}</span>
							<span>{bytes(partition.size)}</span>
						</div>
					{/each}
				</article>
			{:else}
				<p class="text-sm text-muted-foreground">Physical disk details are not available.</p>
			{/each}
		</div>
	</section>

	<section class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Mirror integrity</h2>
		<p class={`mt-2 text-sm font-semibold ${mirror?.healthy ? "text-primary" : "text-destructive"}`}>
			{mirror?.healthy ? "Healthy" : "Needs attention"}
		</p>
		<dl class="mt-4 grid grid-cols-2 gap-y-3 text-sm">
			<dt class="text-muted-foreground">Data profile</dt>
			<dd class="text-right font-medium">{mirror?.dataProfile || "—"}</dd>
			<dt class="text-muted-foreground">Metadata</dt>
			<dd class="text-right font-medium">{mirror?.metadataProfile || "—"}</dd>
			<dt class="text-muted-foreground">Online devices</dt>
			<dd class="text-right font-medium">{mirror?.devicesOnline ?? "—"}</dd>
			<dt class="text-muted-foreground">Device errors</dt>
			<dd class="text-right font-medium">{mirror?.deviceErrors ?? "—"}</dd>
		</dl>
		<p class="mt-5 text-xs leading-5 text-muted-foreground">
			RAID1 profiles duplicate filesystem blocks across the two Data1 devices. Scrub verifies checksums and can repair a damaged copy.
		</p>
		<Button class="mt-5" variant="outline" onclick={onScrub}>Start integrity scrub</Button>
	</section>
</div>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-6">
	<h2 class="text-lg font-bold">Stored content</h2>
	<p class="mt-2 text-sm text-muted-foreground">
		{summary?.posts ?? "—"} posts · {summary?.messages ?? "—"} messages ·
		{summary?.uploads ?? "—"} claimed media objects · {bytes(summary?.mediaBytes)} referenced media
	</p>
	<p class="mt-2 text-sm text-muted-foreground">PostgreSQL database: {bytes(summary?.databaseBytes)}</p>
	<div class="mt-5 grid gap-3 sm:grid-cols-3">
		{#each summary?.mediaByKind ?? [] as usage (usage.kind)}
			<div class="rounded-xl bg-secondary/60 p-4">
				<p class="text-sm font-bold capitalize">{mediaKindLabel(usage.kind)}</p>
				<p class="mt-1 text-lg font-bold">{bytes(usage.bytes)}</p>
				<p class="text-xs text-muted-foreground">{usage.objects} objects</p>
			</div>
		{/each}
	</div>
	<p class="mt-4 text-xs leading-5 text-muted-foreground">
		Content counts come from PostgreSQL; Data1 usage includes the database, media, indexes, logs and filesystem overhead. Deleted or unreferenced files may temporarily use space.
	</p>
</section>

<div class="mt-6">
	<MetricChart title="Data1 usage" points={metrics?.series.storagePercent ?? []} />
</div>
