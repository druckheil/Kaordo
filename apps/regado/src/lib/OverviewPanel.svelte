<script lang="ts">
	// Summarizes account activity, host performance, and service health

	import type { AdminMetrics, AdminSummary, AdminSystem } from "@kaordo/contracts";
	import MetricChart from "./MetricChart.svelte";
	import { formatBytes as bytes, type MetricsWindow, metricsWindows } from "./regado-model";

	let {
		summary,
		system,
		metrics,
		loading,
		timeWindow = $bindable(),
		onWindowChange,
	}: {
		summary: AdminSummary | null;
		system: AdminSystem | null;
		metrics: AdminMetrics | null;
		loading: boolean;
		timeWindow: MetricsWindow;
		onWindowChange: (window: MetricsWindow) => void;
	} = $props();

	const statistics = $derived([
		{ label: "Accounts", value: summary?.users },
		{ label: "Posts", value: summary?.posts },
		{ label: "Messages", value: summary?.messages },
		{ label: "Media objects", value: summary?.uploads },
		{ label: "Referenced media", value: bytes(summary?.mediaBytes) },
		{ label: "Open access cases", value: summary?.openCases },
	]);

	function toMiB(points: { time: number; value: number }[]) {
		return points.map((point) => ({ ...point, value: point.value / 1048576 }));
	}
</script>

<section
	class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
	aria-label="Product statistics"
>
	{#each statistics as statistic (statistic.label)}
		<div class="rounded-[1.3rem] border border-border bg-card p-5 shadow-sm">
			<p class="text-xs font-semibold text-muted-foreground">{statistic.label}</p>
			<p class="mt-3 text-2xl font-bold tracking-tight">{statistic.value ?? "—"}</p>
		</div>
	{/each}
</section>

<div class="mt-7 flex items-center justify-between gap-3">
	<h2 class="text-xl font-bold tracking-tight">Performance</h2>
	<div class="flex gap-1 rounded-xl bg-secondary p-1" aria-label="History window">
		{#each metricsWindows as option (option)}
			<button
				type="button"
				aria-pressed={timeWindow === option}
				onclick={() => onWindowChange(option)}
				class={`rounded-lg px-3 py-1.5 text-xs font-bold ${timeWindow === option ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}
			>{option}</button>
		{/each}
	</div>
</div>

{#if loading}
	<p class="mt-6 text-sm text-muted-foreground" role="status">Loading metrics…</p>
{/if}

<div class="mt-4 grid gap-4 lg:grid-cols-2">
	<MetricChart title="CPU" points={metrics?.series.cpuPercent ?? []} />
	<MetricChart title="Memory" points={metrics?.series.memoryPercent ?? []} />
	<MetricChart
		title="Network"
		points={toMiB(metrics?.series.networkBytesPerSecond ?? [])}
		unit=" MiB/s"
	/>
	<MetricChart
		title="Disk read"
		points={toMiB(metrics?.series.diskReadBytesPerSecond ?? [])}
		unit=" MiB/s"
	/>
	<MetricChart title="Load average" points={metrics?.series.load1 ?? []} unit="" />
	<MetricChart
		title="Disk write"
		points={toMiB(metrics?.series.diskWriteBytesPerSecond ?? [])}
		unit=" MiB/s"
	/>
</div>

<div class="mt-7 grid gap-4 lg:grid-cols-2">
	<section class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Data1 mirror</h2>
		<p class="mt-2 text-sm text-muted-foreground">
			{system?.mirror.healthy
				? "Both devices online · RAID1 data and metadata · no recorded device errors"
				: "Mirror health needs attention or is not yet available."}
		</p>
		<div class="mt-5 text-4xl font-bold tracking-tight text-primary">
			{system?.mirror.mirroredPercent ?? "—"}%
		</div>
		<p class="mt-1 text-xs text-muted-foreground">Used Data1 blocks stored in RAID1</p>
	</section>
	<section class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Services</h2>
		<div class="mt-4 grid grid-cols-2 gap-2">
			{#each system?.services ?? [] as service (service.id)}
				<div class="flex items-center gap-2 text-sm">
					<span
						class={`size-2 rounded-full ${service.active === "active" ? "bg-emerald-500" : "bg-amber-500"}`}
					></span>
					<span class="truncate">{service.id}</span>
				</div>
			{/each}
		</div>
	</section>
</div>
