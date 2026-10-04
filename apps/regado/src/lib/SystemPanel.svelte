<script lang="ts">
	// Presents host metrics and exposes audited maintenance controls

	import type { AdminMetrics, AdminSystem } from "@kaordo/contracts";
	import { Button } from "@kaordo/ui";
	import {
		formatBytes,
		formatDateTime,
		isRestartableService,
		type RestartableService,
	} from "./regado-model";

	let {
		system,
		metrics,
		onRestartDns,
		onRestartService,
	}: {
		system: AdminSystem | null;
		metrics: AdminMetrics | null;
		onRestartDns: () => void;
		onRestartService: (service: RestartableService) => void;
	} = $props();

	const latestCpu = $derived(metrics?.series.cpuPercent?.at(-1)?.value);
	const latestMemory = $derived(metrics?.series.memoryPercent?.at(-1)?.value);
	const uptimeHours = $derived(
		system?.host.uptimeSeconds === undefined
			? null
			: Math.floor(system.host.uptimeSeconds / 3600),
	);

	function restartableServiceId(serviceId: string): RestartableService | null {
		return isRestartableService(serviceId) ? serviceId : null;
	}
</script>

<section class="mt-6 grid gap-4 lg:grid-cols-2">
	<div class="rounded-[1.4rem] border border-border bg-card p-6">
		<p class="text-xs font-bold uppercase tracking-widest text-primary">Server</p>
		<h2 class="mt-2 text-2xl font-bold">{system?.hostname || "Local server"}</h2>
		<p class="mt-2 text-sm text-muted-foreground">Last sample {formatDateTime(system?.time)}</p>
		<p class="mt-3 text-sm text-muted-foreground">
			{system?.host.cpuModel || "CPU model unavailable"} · {system?.host.logicalCores ?? "—"} logical cores ·
			{formatBytes(system?.host.memoryTotalBytes)} RAM
		</p>
		<p class="mt-1 text-xs text-muted-foreground">
			Kernel {system?.host.kernel || "—"} · Up for {uptimeHours ?? "—"} hours
		</p>
		<div class="mt-5 grid grid-cols-2 gap-3">
			<div class="rounded-xl bg-secondary/60 p-4">
				<p class="text-xs text-muted-foreground">CPU</p>
				<p class="mt-2 text-xl font-bold">{latestCpu?.toFixed(1) ?? "—"}%</p>
			</div>
			<div class="rounded-xl bg-secondary/60 p-4">
				<p class="text-xs text-muted-foreground">Memory</p>
				<p class="mt-2 text-xl font-bold">{latestMemory?.toFixed(1) ?? "—"}%</p>
			</div>
		</div>
	</div>

	<div class="rounded-[1.4rem] border border-border bg-card p-6">
		<h2 class="text-lg font-bold">Maintenance</h2>
		<p class="mt-2 text-sm leading-6 text-muted-foreground">
			Actions run through a local allowlisted agent. Every request requires a reason and is written to the audit before execution.
		</p>
		<div class="mt-5 flex flex-wrap gap-2">
			<Button variant="outline" onclick={onRestartDns}>Restart DNS updater</Button>
		</div>
	</div>
</section>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-6">
	<h2 class="text-lg font-bold">Service controls</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each system?.services ?? [] as service (service.id)}
			{@const restartableId = restartableServiceId(service.id)}
			<div class="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 p-4">
				<div class="min-w-0">
					<p class="truncate text-sm font-bold">{service.id}</p>
					<p class="text-xs text-muted-foreground">{service.active || "unknown"} · {service.substate || "unknown"}</p>
				</div>
				{#if restartableId}
					<Button
						size="xs"
						variant="outline"
						onclick={() => onRestartService(restartableId)}
					>
						Restart
					</Button>
				{/if}
			</div>
		{/each}
	</div>
</section>
