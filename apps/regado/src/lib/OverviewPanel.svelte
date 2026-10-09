<script lang="ts">
	// Summarizes account activity, host performance, and service health

	import type { AdminMetrics, AdminSummary, AdminSystem } from '@kaordo/contracts';
	import MetricChart from './MetricChart.svelte';
	import ServiceStatus from './ServiceStatus.svelte';
	import { serviceDescription } from './system-model';
	import {
		formatBytes as bytes,
		storageDevices,
		type MetricsWindow,
		metricsWindows
	} from './regado-model';

	let {
		summary,
		system,
		metrics,
		loading,
		timeWindow = $bindable(),
		onWindowChange
	}: {
		summary: AdminSummary | null;
		system: AdminSystem | null;
		metrics: AdminMetrics | null;
		loading: boolean;
		timeWindow: MetricsWindow;
		onWindowChange: (window: MetricsWindow) => void;
	} = $props();

	const statistics = $derived([
		{ label: 'Accounts', value: summary?.users },
		{ label: 'Posts', value: summary?.posts },
		{ label: 'Messages', value: summary?.messages },
		{ label: 'Media objects', value: summary?.uploads },
		{ label: 'Referenced media', value: bytes(summary?.mediaBytes) }
	]);
	const disks = $derived(storageDevices(system?.disks ?? []));
	const poolMembers = $derived(
		new Set((system?.mounts ?? []).flatMap((mount) => mount.integrity?.members ?? [])).size
	);
	const diskHealthWarnings = $derived(
		disks.filter((disk) => disk.health?.state === 'warning' || disk.health?.state === 'failed')
			.length
	);
	const unavailableSmart = $derived(
		disks.filter(
			(disk) =>
				!disk.health || disk.health.state === 'unavailable' || disk.health.state === 'standby'
		).length
	);

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
			<p class="text-xs font-semibold text-muted-foreground">
				{statistic.label}
			</p>
			<p class="mt-3 text-2xl font-bold tracking-tight">
				{statistic.value ?? '—'}
			</p>
		</div>
	{/each}
</section>

<div class="mt-7 flex items-center justify-between gap-3">
	<h2 class="text-xl font-bold tracking-tight">Performance</h2>
	<div class="flex gap-1 rounded-xl bg-muted p-1" aria-label="History window">
		{#each metricsWindows as option (option)}
			<button
				type="button"
				aria-pressed={timeWindow === option}
				onclick={() => onWindowChange(option)}
				class={`rounded-lg px-3 py-1.5 text-xs font-bold ${timeWindow === option ? 'bg-card text-link shadow-sm' : 'text-muted-foreground'}`}
				>{option}</button
			>
		{/each}
	</div>
</div>

{#if loading}
	<p class="mt-6 text-sm text-muted-foreground" role="status">Loading metrics…</p>
{/if}

<div class="mt-4 grid gap-4 lg:grid-cols-2">
	<MetricChart
		title="CPU"
		points={metrics?.series.cpuPercent ?? []}
		description="Percentage of total CPU capacity in use, averaged across logical cores over two minutes."
	/>
	<MetricChart
		title="Memory"
		points={metrics?.series.memoryPercent ?? []}
		description="Percentage of RAM in use, based on the memory available to applications."
	/>
	<MetricChart
		title="Network"
		points={toMiB(metrics?.series.networkBytesPerSecond ?? [])}
		unit=" MiB/s"
		description="Combined receive and transmit throughput across network interfaces, excluding loopback. MiB/s means mebibytes per second."
	/>
	<MetricChart
		title="Disk read"
		points={toMiB(metrics?.series.diskReadBytesPerSecond ?? [])}
		unit=" MiB/s"
		description="Combined disk-read throughput across block devices, averaged over two minutes. MiB/s means mebibytes per second."
	/>
	<MetricChart
		title="Load average"
		points={metrics?.series.load1 ?? []}
		unit=""
		description="The one-minute average number of runnable tasks and tasks waiting for disk I/O. This is a task count, not a percentage; compare it with the number of CPU cores."
	/>
	<MetricChart
		title="Disk write"
		points={toMiB(metrics?.series.diskWriteBytesPerSecond ?? [])}
		unit=" MiB/s"
		description="Combined disk-write throughput across block devices, averaged over two minutes. MiB/s means mebibytes per second."
	/>
</div>

<div class="mt-7 grid gap-4 lg:grid-cols-2">
	<section class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Storage</h2>
		<p class="mt-2 text-sm text-muted-foreground">
			{system
				? `${disks.length} physical ${disks.length === 1 ? 'disk' : 'disks'} · ${poolMembers} data-pool ${poolMembers === 1 ? 'member' : 'members'} · ${system.swapDevices.length} swap device${system.swapDevices.length === 1 ? '' : 's'}`
				: 'Discovering host storage…'}
		</p>
		<div class="mt-5 text-4xl font-bold tracking-tight text-link">
			{system ? disks.length : '—'}
		</div>
		<p class="mt-1 text-xs text-muted-foreground">
			{!system
				? 'SMART status loads in the background'
				: diskHealthWarnings > 0
					? `${diskHealthWarnings} ${diskHealthWarnings === 1 ? 'device needs' : 'devices need'} attention`
					: unavailableSmart > 0
						? `No warnings reported · SMART unavailable or in standby on ${unavailableSmart} ${unavailableSmart === 1 ? 'device' : 'devices'}`
						: 'No SMART warnings reported'}
		</p>
	</section>
	<section class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Services</h2>
		<div class="mt-4 grid grid-cols-2 gap-2">
			{#each system?.services ?? [] as service (service.id)}
				<div class="flex min-w-0 flex-wrap items-center justify-between gap-1.5 text-sm">
					<span class="truncate">{serviceDescription(service.id).name}</span><ServiceStatus
						{service}
					/>
				</div>
			{/each}
		</div>
	</section>
</div>
