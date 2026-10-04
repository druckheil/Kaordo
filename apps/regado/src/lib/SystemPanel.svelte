<script lang="ts">
	// Presents host health, scheduled maintenance and contextual service controls
	import type { AdminMetrics, AdminSystem } from "@kaordo/contracts";
	import { Button } from "@kaordo/ui";
	import ContextHelp from "./ContextHelp.svelte";
	import ServiceStatus from "./ServiceStatus.svelte";
	import { serviceDescription } from "./system-model";
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
		onOpenStorage,
	}: {
		system: AdminSystem | null;
		metrics: AdminMetrics | null;
		onRestartDns: () => void;
		onRestartService: (service: RestartableService) => void;
		onOpenStorage: () => void;
	} = $props();
	const latestCpu = $derived(metrics?.series.cpuPercent?.at(-1)?.value);
	const latestMemory = $derived(metrics?.series.memoryPercent?.at(-1)?.value);
	const dns = $derived(
		system?.services.find((service) => service.id === "ddclient"),
	);
	const pools = $derived(
		system?.mounts.filter((mount) => mount.integrity) ?? [],
	);
	const uptimeHours = $derived(
		system?.host.uptimeSeconds === undefined
			? null
			: Math.floor(system.host.uptimeSeconds / 3600),
	);
</script>

<section class="mt-6 grid gap-4 lg:grid-cols-2">
	<div class="rounded-[1.4rem] border border-border bg-card p-6">
		<p class="text-xs font-bold uppercase tracking-widest text-primary">
			Server
		</p>
		<h2 class="mt-2 text-2xl font-bold">
			{system?.hostname || "Local server"}
		</h2>
		<p class="mt-2 text-sm text-muted-foreground">
			Last sample {formatDateTime(system?.time)}
		</p>
		<p class="mt-3 text-sm text-muted-foreground">
			{system?.host.cpuModel || "CPU model unavailable"} · {system?.host
				.logicalCores ?? "—"} logical cores · {formatBytes(
				system?.host.memoryTotalBytes,
			)} RAM
		</p>
		<p class="mt-1 text-xs text-muted-foreground">
			{system?.host.osName || "Operating system"}
			{system?.host.osVersion || ""} · Kernel {system?.host.kernel || "—"} · Up for
			{uptimeHours ?? "—"} hours
		</p>
		<div class="mt-5 grid grid-cols-2 gap-3">
			<div class="rounded-xl bg-secondary/60 p-4">
				<p class="text-xs text-muted-foreground">CPU usage</p>
				<p class="mt-2 text-xl font-bold">
					{latestCpu === undefined ? "—" : latestCpu.toFixed(1) + "%"}
				</p>
			</div>
			<div class="rounded-xl bg-secondary/60 p-4">
				<p class="text-xs text-muted-foreground">RAM usage</p>
				<p class="mt-2 text-xl font-bold">
					{latestMemory === undefined ? "—" : latestMemory.toFixed(1) + "%"}
				</p>
			</div>
		</div>
	</div>
	<section
		class="min-w-0 rounded-[1.4rem] border border-border bg-card p-6"
		aria-label="Maintenance"
	>
		<div class="flex items-center gap-1">
			<h2 class="text-lg font-bold">Maintenance</h2>
			<ContextHelp label="Maintenance"
				><p>Actions require a reason and are audited before execution.</p>
				<p>
					Scheduled jobs stop between runs. Their timer and last outcome
					determine health.
				</p>
				<p>
					Disk operations are managed in Storage, where their measured progress
					and results remain visible.
				</p></ContextHelp
			>
		</div>
		<div class="mt-4 space-y-3">
			<section
				class="rounded-xl border border-border p-3"
				aria-label="DNS maintenance"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex items-center gap-1">
						<h3 class="text-sm font-semibold">DNS updates</h3>
						<ContextHelp label="Automatic DNS updates"
							><p>
								The updater checks the public IP and updates the domain when
								needed. It runs once per timer event, then exits.
							</p>
							<p>
								Update now runs one check and starts the automatic timer if
								necessary. A successful check may leave DNS unchanged when the
								IP is already correct.
							</p></ContextHelp
						>
					</div>
					{#if dns}<ServiceStatus service={dns} />{:else}<span
							class="text-xs text-muted-foreground">Unavailable</span
						>{/if}
				</div>
				<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
					<dt class="text-muted-foreground">Automatic timer</dt>
					<dd class="text-right">
						{dns?.timer?.active === "active"
							? "Enabled"
							: "Unavailable or stopped"}
					</dd>
					<dt class="text-muted-foreground">Last check</dt>
					<dd class="text-right">
						{formatDateTime(dns?.finishedAt || dns?.timer?.lastRunAt)}
					</dd>
					<dt class="text-muted-foreground">Last outcome</dt>
					<dd class="break-words text-right">
						{dns?.result === "success"
							? "Successful"
							: dns?.result ||
								"No outcome available"}{#if dns?.exitCode !== undefined}
							· code {dns.exitCode}{/if}
					</dd>
					<dt class="text-muted-foreground">Next check</dt>
					<dd class="text-right">{formatDateTime(dns?.timer?.nextRunAt)}</dd>
				</dl>
				<Button
					class="mt-3"
					size="xs"
					variant="outline"
					onclick={onRestartDns}
					disabled={!dns ||
						dns.loaded !== "loaded" ||
						dns.active === "activating"}>Update now</Button
				>
			</section>
			<section
				class="rounded-xl border border-border p-3"
				aria-label="Storage maintenance"
			>
				<div class="flex items-center gap-1">
					<h3 class="text-sm font-semibold">File checks</h3>
					<ContextHelp label="File checks"
						><p>
							Check copies scans checksums and refreshes the file inventory.
							Repair and clean up restores redundant placement and removes only
							expired, unreferenced uploads.
						</p>
						<p>
							Run either operation in Storage. An unchecked pool is not counted
							as verified.
						</p></ContextHelp
					>
				</div>
				{#each pools as pool (pool.path)}
					{@const report = system?.replicationReports?.find(
						(item) => item.path === pool.path,
					)}
					<div class="mt-3 text-xs">
						<div class="flex flex-wrap justify-between gap-2">
							<span class="break-all font-medium">{pool.path}</span><span
								class={report?.state === "failed"
									? "text-destructive"
									: "text-muted-foreground"}
								>{report?.state === "complete"
									? report.checksumState === "passed"
										? "Checksums passed"
										: "Needs attention"
									: report?.state === "checking"
										? "Checking"
										: report?.state === "repairing"
											? "Repairing"
											: report?.state === "failed"
												? "Failed"
												: "Not checked"}</span
							>
						</div>
						<p class="mt-1 text-muted-foreground">
							Last check {formatDateTime(report?.checkedAt)}
						</p>
					</div>
				{:else}<p class="mt-3 text-xs text-muted-foreground">
						No managed storage pools detected.
					</p>{/each}
				<Button class="mt-3" size="xs" variant="outline" onclick={onOpenStorage}
					>Open storage</Button
				>
			</section>
		</div>
	</section>
</section>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-6">
	<div class="flex items-center gap-1">
		<h2 class="text-lg font-bold">Service controls</h2>
		<ContextHelp label="Service controls"
			><p>
				Status reflects the process outcome and, for scheduled services, its
				timer.
			</p>
			<p>
				Only services with an in-panel operation can be restarted here. Core
				authentication, database and administration services use reviewed host
				maintenance.
			</p></ContextHelp
		>
	</div>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each system?.services ?? [] as service (service.id)}
			{@const description = serviceDescription(service.id)}
			{@const restartId = isRestartableService(service.id) ? service.id : null}
			<section
				class="min-w-0 rounded-xl bg-secondary/50 p-4"
				aria-label={description.name + " service"}
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-1">
						<h3 class="truncate text-sm font-bold">{description.name}</h3>
						<ContextHelp label={description.name}
							><p>{description.purpose}</p>
							<p>{description.restart}</p>
							<p>
								Unit: {service.id}.service · {service.loaded || "unknown"} · {service.active ||
									"unknown"} / {service.substate || "unknown"}
							</p>
							{#if service.result}<p>
									Last outcome: {service.result}{#if service.exitCode !== undefined}
										· code {service.exitCode}{/if}
								</p>{/if}</ContextHelp
						>
					</div>
					<ServiceStatus {service} />
				</div>
				<p class="mt-2 break-all font-mono text-[11px] text-muted-foreground">
					{service.id}.service
				</p>
				{#if restartId}<Button
						class="mt-3"
						size="xs"
						variant="outline"
						disabled={service.loaded !== "loaded" ||
							service.active === "activating" ||
							service.active === "deactivating"}
						onclick={() => onRestartService(restartId)}
						>{restartId === "ddclient" ? "Update now" : "Restart"}</Button
					>{/if}
			</section>
		{/each}
	</div>
</section>
