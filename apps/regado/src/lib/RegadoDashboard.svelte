<script lang="ts">
	import { onMount } from "svelte";
	import { createAdminApi } from "@kaordo/api-client";
	import type {
		AdminAccessCase,
		AdminAuditEntry,
		AdminContentPage,
		AdminLogs,
		AdminMetrics,
		AdminSummary,
		AdminSystem,
		AdminUser,
		UserIdentity,
	} from "@kaordo/contracts";
	import { appPaths } from "@kaordo/links";
	import {
		Button,
		Dialog,
		Input,
		Textarea,
		ShieldCheckIcon,
		SearchIcon,
	} from "@kaordo/ui";
	import MetricChart from "./MetricChart.svelte";

	let { user }: { user: UserIdentity } = $props();
	const api = createAdminApi(
		import.meta.env.VITE_KAORDO_API_URL ||
			(typeof window !== "undefined" ? window.location.origin : ""),
	);
	const tabs = [
		"Overview",
		"Storage",
		"Logs",
		"Users",
		"Audit",
		"System",
	] as const;
	type Tab = (typeof tabs)[number];
	const logServices = [
		"kerno",
		"nodo",
		"keycloak",
		"postgresql",
		"caddy",
		"livekit",
		"ddclient",
		"prometheus",
		"prometheus-node-exporter",
		"regado-agent",
	];

	let tab = $state<Tab>("Overview");
	let summary = $state<AdminSummary | null>(null);
	let system = $state<AdminSystem | null>(null);
	let metrics = $state<AdminMetrics | null>(null);
	let timeWindow = $state<"1h" | "24h" | "7d">("1h");
	let users = $state<AdminUser[]>([]);
	let search = $state("");
	let audit = $state<AdminAuditEntry[]>([]);
	let logs = $state<AdminLogs | null>(null);
	let logService = $state("kerno");
	let logLevel = $state("all");
	let logSearch = $state("");
	let caseRecord = $state<AdminAccessCase | null>(null);
	let content = $state<AdminContentPage | null>(null);
	let contentKind = $state<"posts" | "messages">("posts");
	let loading = $state(true);
	let sectionLoading = $state(false);
	let error = $state("");
	let actionError = $state("");
	let notice = $state("");
	let busy = $state(false);
	let intent = $state<{
		type: "status" | "role" | "case" | "action";
		id: string;
		name: string;
		disabled?: boolean;
		isAdmin?: boolean;
	} | null>(null);
	let reason = $state("");
	let overviewRequest = 0;
	let usersRequest = 0;
	let logsRequest = 0;

	const visibleLogs = $derived(
		(logs?.items ?? []).filter(
			(item) =>
				(logLevel === "all" || item.priority === logLevel) &&
				item.message.toLowerCase().includes(logSearch.toLowerCase()),
		),
	);

	function bytes(value: number | undefined): string {
		if (value === undefined || !Number.isFinite(value)) return "—";
		const units = ["B", "KiB", "MiB", "GiB", "TiB"];
		let count = value;
		let index = 0;
		while (count >= 1024 && index < units.length - 1) {
			count /= 1024;
			index++;
		}
		return `${count.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
	}
	function time(value: string | null | undefined): string {
		return value ? new Date(value).toLocaleString() : "—";
	}
	function logTime(value: string): string {
		const micros = Number(value);
		return Number.isFinite(micros) && micros > 0
			? new Date(micros / 1000).toLocaleString()
			: "—";
	}
	function errorMessage(cause: unknown): string {
		return cause instanceof Error ? cause.message : "The request failed.";
	}

	async function refreshOverview() {
		const request = ++overviewRequest;
		const result = await Promise.allSettled([
			api.summary(),
			api.system(),
			api.metrics(timeWindow),
		]);
		if (request !== overviewRequest) return;
		if (result[0].status === "fulfilled") summary = result[0].value;
		if (result[1].status === "fulfilled") system = result[1].value;
		if (result[2].status === "fulfilled") metrics = result[2].value;
		const failure = result.find((item) => item.status === "rejected");
		error = failure?.status === "rejected" ? errorMessage(failure.reason) : "";
		loading = false;
	}

	onMount(() => {
		void refreshOverview();
		const interval = window.setInterval(() => {
			if (
				document.visibilityState === "visible" &&
				(tab === "Overview" || tab === "Storage" || tab === "System")
			)
				void refreshOverview();
		}, 30_000);
		return () => window.clearInterval(interval);
	});

	async function openTab(next: Tab) {
		tab = next;
		error = "";
		if (next === "Users") await loadUsers();
		else if (next === "Audit") await loadAudit();
		else if (next === "Logs") await loadLogs();
		else if (next === "Overview" || next === "Storage" || next === "System")
			await refreshOverview();
	}
	async function loadUsers() {
		const request = ++usersRequest;
		sectionLoading = true;
		try {
			const page = await api.users(search);
			if (request === usersRequest) {
				users = page.items;
				error = "";
			}
		} catch (cause) {
			if (request === usersRequest) error = errorMessage(cause);
		} finally {
			if (request === usersRequest) sectionLoading = false;
		}
	}
	async function loadAudit() {
		sectionLoading = true;
		try {
			audit = (await api.audit()).items;
			error = "";
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			sectionLoading = false;
		}
	}
	async function loadLogs() {
		const request = ++logsRequest;
		sectionLoading = true;
		try {
			const page = await api.logs(logService);
			if (request === logsRequest) {
				logs = page;
				error = "";
			}
		} catch (cause) {
			if (request === logsRequest) error = errorMessage(cause);
		} finally {
			if (request === logsRequest) sectionLoading = false;
		}
	}
	async function loadContent(reset = false) {
		if (!caseRecord) return;
		const id = caseRecord.id;
		const kind = contentKind;
		if (reset) content = null;
		sectionLoading = true;
		try {
			const page = await api.caseContent(
				id,
				kind,
				reset ? undefined : (content?.nextCursor ?? undefined),
			);
			if (caseRecord?.id !== id || contentKind !== kind) return;
			content = reset
				? page
				: {
						items: [...(content?.items ?? []), ...page.items],
						nextCursor: page.nextCursor,
					};
			error = "";
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			sectionLoading = false;
		}
	}
	async function closeCase() {
		if (!caseRecord || busy) return;
		busy = true;
		try {
			await api.closeCase(caseRecord.id);
			caseRecord = null;
			content = null;
			notice = "Access case closed.";
			error = "";
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
	function downloadLogs() {
		if (!logs) return;
		const url = URL.createObjectURL(
			new Blob(
				[
					JSON.stringify(
						{
							service: logs.service,
							exportedAt: new Date().toISOString(),
							items: visibleLogs,
						},
						null,
						2,
					),
				],
				{ type: "application/json" },
			),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = `kaordo-${logs.service}-journal.json`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function openIntent(next: NonNullable<typeof intent>) {
		intent = next;
		reason = "";
		actionError = "";
		notice = "";
	}
	async function confirmIntent() {
		if (!intent || busy) return;
		busy = true;
		actionError = "";
		error = "";
		notice = "";
		try {
			if (intent.type === "status") {
				await api.setStatus(intent.id, !!intent.disabled, reason);
				notice = `${intent.name} ${intent.disabled ? "disabled" : "enabled"}.`;
				await loadUsers();
			} else if (intent.type === "role") {
				await api.setRole(intent.id, !!intent.isAdmin, reason);
				notice = `Administrator role ${intent.isAdmin ? "granted to" : "revoked from"} @${intent.name}.`;
				await loadUsers();
			} else if (intent.type === "case") {
				caseRecord = await api.createCase(intent.id, reason);
				contentKind = "posts";
				content = null;
				await loadContent(true);
				notice = `Access case opened for @${caseRecord.targetUsername}. The account was notified in Saved messages.`;
			} else {
				await api.action(
					intent.id as
						| "restart-nodo"
						| "restart-livekit"
						| "restart-ddclient"
						| "scrub-data",
					reason,
				);
				notice = `${intent.name} requested.`;
				await refreshOverview();
			}
			intent = null;
		} catch (cause) {
			actionError = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

{#snippet accountActions(account: AdminUser)}
	<div class="flex flex-wrap justify-end gap-2">
		{#if account.id !== user.id}
			<Button
				size="xs"
				variant="outline"
				onclick={() =>
					openIntent({
						type: "case",
						id: account.id,
						name: account.username,
					})}>Access case</Button
			>
			{#if !account.isAdmin}<Button
					size="xs"
					variant="outline"
					onclick={() =>
						openIntent({
							type: "status",
							id: account.id,
							name: account.username,
							disabled: !account.disabledAt,
						})}>{account.disabledAt ? "Enable" : "Disable"}</Button
				>{/if}
			<Button
				size="xs"
				variant="outline"
				disabled={!!account.disabledAt}
				onclick={() =>
					openIntent({
						type: "role",
						id: account.id,
						name: account.username,
						isAdmin: !account.isAdmin,
					})}>{account.isAdmin ? "Revoke admin" : "Grant admin"}</Button
			>
		{:else}<span class="text-xs text-muted-foreground">Your account</span>{/if}
	</div>
{/snippet}

<svelte:head><title>Regado | Kaordo</title></svelte:head>

<a
	href="#regado-main"
	class="sr-only focus:not-sr-only fixed left-3 top-3 z-50 rounded-xl bg-card p-3 font-semibold shadow-lg"
	>Skip to main content</a
>
<div
	class="min-h-dvh bg-[radial-gradient(circle_at_90%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_38%)]"
>
	<header
		class="sticky top-0 z-20 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-xl sm:px-8"
	>
		<div class="mx-auto flex max-w-7xl items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<span
					class="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground"
					><ShieldCheckIcon class="size-5" /></span
				>
				<div>
					<p class="text-sm font-bold tracking-tight">Regado</p>
					<p class="text-xs text-muted-foreground">Kaordo administration</p>
				</div>
			</div>
			<div class="flex items-center gap-4 text-sm">
				<span class="hidden text-muted-foreground sm:inline"
					>@{user.username}</span
				><a
					class="font-semibold text-primary hover:underline"
					href={appPaths.portal}>All apps ↗</a
				>
			</div>
		</div>
	</header>

	<main
		id="regado-main"
		class="mx-auto max-w-7xl px-4 pb-16 pt-7 sm:px-8 sm:pt-10"
	>
		<div class="flex flex-wrap items-end justify-between gap-4">
			<div>
				<p class="text-xs font-bold uppercase tracking-[0.2em] text-primary">
					Local operations
				</p>
				<h1 class="mt-1 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
					System overview
				</h1>
				<p class="mt-2 text-sm text-muted-foreground">
					Live service health, mirrored storage and accountable administration.
				</p>
			</div>
			<Button
				variant="outline"
				onclick={() => void refreshOverview()}
				disabled={loading}>Refresh data</Button
			>
		</div>
		<nav
			class="kaordo-scrollbar mt-7 flex gap-1 overflow-x-auto border-b border-border"
			aria-label="Regado sections"
		>
			{#each tabs as item}
				<button
					type="button"
					onclick={() => void openTab(item)}
					aria-current={tab === item ? "page" : undefined}
					class={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-ring ${tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
					>{item}</button
				>
			{/each}
		</nav>

		{#if error}<p
				class="mt-5 rounded-2xl border border-destructive/30 bg-destructive/7 p-4 text-sm text-destructive"
				role="alert"
			>
				{error}
			</p>{/if}
		{#if notice}<p
				class="mt-5 rounded-2xl border border-primary/25 bg-primary/7 p-4 text-sm text-foreground"
				role="status"
			>
				{notice}
			</p>{/if}

		{#if tab === "Overview"}
			<section
				class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
				aria-label="Product statistics"
			>
				{#each [["Accounts", summary?.users], ["Posts", summary?.posts], ["Messages", summary?.messages], ["Media objects", summary?.uploads], ["Referenced media", bytes(summary?.mediaBytes)], ["Open access cases", summary?.openCases]] as [label, value]}
					<div
						class="rounded-[1.3rem] border border-border bg-card p-5 shadow-sm"
					>
						<p class="text-xs font-semibold text-muted-foreground">{label}</p>
						<p class="mt-3 text-2xl font-bold tracking-tight">{value ?? "—"}</p>
					</div>
				{/each}
			</section>
			<div class="mt-7 flex items-center justify-between gap-3">
				<h2 class="text-xl font-bold tracking-tight">Performance</h2>
				<div
					class="flex gap-1 rounded-xl bg-secondary p-1"
					aria-label="History window"
				>
					{#each ["1h", "24h", "7d"] as option}<button
							type="button"
							onclick={() => {
								timeWindow = option as typeof timeWindow;
								void refreshOverview();
							}}
							class={`rounded-lg px-3 py-1.5 text-xs font-bold ${timeWindow === option ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}
							>{option}</button
						>{/each}
				</div>
			</div>
			{#if loading}<p class="mt-6 text-sm text-muted-foreground" role="status">
					Loading metrics…
				</p>{/if}
			<div class="mt-4 grid gap-4 lg:grid-cols-2">
				<MetricChart title="CPU" points={metrics?.series.cpuPercent ?? []} />
				<MetricChart
					title="Memory"
					points={metrics?.series.memoryPercent ?? []}
				/>
				<MetricChart
					title="Network"
					points={(metrics?.series.networkBytesPerSecond ?? []).map(
						(point) => ({ ...point, value: point.value / 1048576 }),
					)}
					unit=" MiB/s"
				/>
				<MetricChart
					title="Disk read"
					points={(metrics?.series.diskReadBytesPerSecond ?? []).map(
						(point) => ({ ...point, value: point.value / 1048576 }),
					)}
					unit=" MiB/s"
				/>
				<MetricChart
					title="Load average"
					points={metrics?.series.load1 ?? []}
					unit=""
				/>
				<MetricChart
					title="Disk write"
					points={(metrics?.series.diskWriteBytesPerSecond ?? []).map(
						(point) => ({ ...point, value: point.value / 1048576 }),
					)}
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
					<p class="mt-1 text-xs text-muted-foreground">
						Used Data1 blocks stored in RAID1
					</p>
				</section>
				<section class="rounded-[1.4rem] border border-border bg-card p-6">
					<h2 class="text-lg font-bold">Services</h2>
					<div class="mt-4 grid grid-cols-2 gap-2">
						{#each system?.services ?? [] as service}<div
								class="flex items-center gap-2 text-sm"
							>
								<span
									class={`size-2 rounded-full ${service.active === "active" ? "bg-emerald-500" : "bg-amber-500"}`}
								></span><span class="truncate">{service.id}</span>
							</div>{/each}
					</div>
				</section>
			</div>
		{:else if tab === "Storage"}
			<div class="mt-6 grid gap-4 lg:grid-cols-2">
				{#each system?.mounts ?? [] as mount}
					<section class="rounded-[1.4rem] border border-border bg-card p-6">
						<div class="flex justify-between gap-4">
							<div>
								<p
									class="text-xs font-bold uppercase tracking-widest text-primary"
								>
									{mount.path === "/" ? "NisOS" : "Data1"}
								</p>
								<h2 class="mt-2 font-mono text-sm">{mount.path}</h2>
							</div>
							<p class="text-sm font-bold">
								{Math.round((mount.used / Math.max(1, mount.total)) * 100)}%
							</p>
						</div>
						<div class="mt-5 h-3 overflow-hidden rounded-full bg-secondary">
							<div
								class="h-full rounded-full bg-primary"
								style:width={`${Math.min(100, (mount.used / Math.max(1, mount.total)) * 100)}%`}
							></div>
						</div>
						<p class="mt-3 text-xs text-muted-foreground">
							{bytes(mount.used)} used · {bytes(mount.free)} available · {bytes(
								mount.total,
							)} total
						</p>
					</section>
				{/each}
			</div>
			<div class="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
				<section class="rounded-[1.4rem] border border-border bg-card p-6">
					<h2 class="text-lg font-bold">Physical disks</h2>
					<div class="mt-4 space-y-3">
						{#each (system?.disks ?? []).filter((item) => item.model) as disk}<div
								class="rounded-xl bg-secondary/60 p-4"
							>
								<div class="flex items-center justify-between gap-3">
									<strong class="text-sm">{disk.model || disk.name}</strong
									><span class="text-xs text-muted-foreground"
										>{bytes(disk.size)}</span
									>
								</div>
								<p class="mt-1 font-mono text-xs text-muted-foreground">
									{disk.path}
								</p>
								{#if disk.health}
									<div
										class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
									>
										<strong
											class={disk.health.state === "passed"
												? "text-primary"
												: ["failed", "warning"].includes(disk.health.state)
													? "text-destructive"
													: "text-muted-foreground"}
											>SMART {disk.health.state}</strong
										>
										<span>{disk.health.temperatureC ?? "—"} °C</span><span
											>{disk.health.powerOnHours?.toLocaleString() ?? "—"} hours</span
										>
									</div>
									<p class="mt-2 text-xs text-muted-foreground">
										Reallocated {disk.health.reallocatedSectors ?? "—"} · Pending
										{disk.health.pendingSectors ?? "—"} · Uncorrectable {disk
											.health.uncorrectableSectors ?? "—"}
									</p>
									<p class="mt-1 text-xs text-muted-foreground">
										Checked {time(disk.health.checkedAt)} · Updates every 5 minutes
									</p>
								{/if}{#each disk.children ?? [] as part}<div
										class="mt-2 flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs"
									>
										<span
											>{part.label || part.name} · {part.fsType ||
												part.type}</span
										><span>{bytes(part.size)}</span>
									</div>{/each}
							</div>{/each}
					</div>
				</section>
				<section class="rounded-[1.4rem] border border-border bg-card p-6">
					<h2 class="text-lg font-bold">Mirror integrity</h2>
					<p
						class={`mt-2 text-sm font-semibold ${system?.mirror.healthy ? "text-primary" : "text-destructive"}`}
					>
						{system?.mirror.healthy ? "Healthy" : "Needs attention"}
					</p>
					<dl class="mt-4 grid grid-cols-2 gap-y-3 text-sm">
						<dt class="text-muted-foreground">Data profile</dt>
						<dd class="text-right font-medium">
							{system?.mirror.dataProfile || "—"}
						</dd>
						<dt class="text-muted-foreground">Metadata</dt>
						<dd class="text-right font-medium">
							{system?.mirror.metadataProfile || "—"}
						</dd>
						<dt class="text-muted-foreground">Online devices</dt>
						<dd class="text-right font-medium">
							{system?.mirror.devicesOnline ?? "—"}
						</dd>
						<dt class="text-muted-foreground">Device errors</dt>
						<dd class="text-right font-medium">
							{system?.mirror.deviceErrors ?? "—"}
						</dd>
					</dl>
					<p class="mt-5 text-xs leading-5 text-muted-foreground">
						RAID1 profiles duplicate filesystem blocks across the two Data1
						devices. Scrub verifies checksums and can repair a damaged copy.
					</p>
					<Button
						class="mt-5"
						variant="outline"
						onclick={() =>
							openIntent({
								type: "action",
								id: "scrub-data",
								name: "Start Data1 scrub",
							})}>Start integrity scrub</Button
					>
				</section>
			</div>
			<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-6">
				<h2 class="text-lg font-bold">Stored content</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					{summary?.posts ?? "—"} posts · {summary?.messages ?? "—"} messages · {summary?.uploads ??
						"—"} claimed media objects · {bytes(summary?.mediaBytes)} referenced media
				</p>
				<p class="mt-2 text-sm text-muted-foreground">
					PostgreSQL database: {bytes(summary?.databaseBytes)}
				</p>
				<div class="mt-5 grid gap-3 sm:grid-cols-3">
					{#each summary?.mediaByKind ?? [] as usage}
						<div class="rounded-xl bg-secondary/60 p-4">
							<p class="text-sm font-bold capitalize">
								{usage.kind === "image"
									? "Photos"
									: usage.kind === "video"
										? "Videos"
										: "Files"}
							</p>
							<p class="mt-1 text-lg font-bold">{bytes(usage.bytes)}</p>
							<p class="text-xs text-muted-foreground">
								{usage.objects} objects
							</p>
						</div>
					{/each}
				</div>
				<p class="mt-4 text-xs leading-5 text-muted-foreground">
					Content counts come from PostgreSQL; Data1 usage includes the
					database, media, indexes, logs and filesystem overhead. Deleted or
					unreferenced files may temporarily use space.
				</p>
			</section>
			<div class="mt-6">
				<MetricChart
					title="Data1 usage"
					points={metrics?.series.storagePercent ?? []}
				/>
			</div>
		{:else if tab === "Logs"}
			<section
				class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6"
			>
				<div class="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h2 class="text-lg font-bold">Service journal</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							The latest 80 entries per service.
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<label class="text-xs font-semibold text-muted-foreground"
							>Service<select
								bind:value={logService}
								onchange={() => void loadLogs()}
								class="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
								>{#each logServices as service}<option value={service}
										>{service}</option
									>{/each}</select
							></label
						><label class="text-xs font-semibold text-muted-foreground"
							>Priority<select
								bind:value={logLevel}
								class="mt-1 block rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
								><option value="all">All</option><option value="3"
									>Errors</option
								><option value="4">Warnings</option><option value="6"
									>Info</option
								></select
							></label
						><Button
							variant="outline"
							onclick={() => void loadLogs()}
							disabled={sectionLoading}>Refresh</Button
						><Button variant="outline" onclick={downloadLogs} disabled={!logs}
							>Download JSON</Button
						>
					</div>
				</div>
				<Input
					class="mt-4"
					bind:value={logSearch}
					placeholder="Filter journal messages"
					aria-label="Filter journal messages"
				/>{#if sectionLoading}<p
						class="mt-6 text-sm text-muted-foreground"
						role="status"
					>
						Loading logs…
					</p>{/if}
				<div
					class="kaordo-scrollbar mt-5 max-h-[60dvh] space-y-1 overflow-auto rounded-xl bg-secondary/40 p-3 font-mono text-xs"
				>
					{#each visibleLogs as entry}<div
							class="grid gap-1 border-b border-border/70 px-2 py-2 sm:grid-cols-[10rem_1fr]"
						>
							<time class="text-muted-foreground">{logTime(entry.time)}</time>
							<p class="break-all whitespace-pre-wrap">{entry.message}</p>
						</div>{:else}<p class="p-4 text-muted-foreground">
							No entries match this filter.
						</p>{/each}
				</div>
			</section>
		{:else if tab === "Users"}
			<section
				class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6"
			>
				<div class="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h2 class="text-lg font-bold">Accounts</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							Activity, owned media and access controls.
						</p>
					</div>
					<form
						class="flex w-full min-w-0 gap-2 sm:w-auto"
						onsubmit={(event) => {
							event.preventDefault();
							void loadUsers();
						}}
					>
						<Input
							bind:value={search}
							placeholder="Find an account"
							aria-label="Find an account"
							class="w-0 flex-1 sm:w-64"
						/><Button type="submit" variant="outline"
							><SearchIcon class="size-4" /> Search</Button
						>
					</form>
				</div>
				{#if sectionLoading}<p
						class="mt-5 text-sm text-muted-foreground"
						role="status"
					>
						Loading accounts…
					</p>{/if}
				<div class="mt-5 grid gap-3 md:hidden">
					{#each users as account}
						<article class="min-w-0 rounded-xl border border-border p-4">
							<h3 class="break-all text-sm font-bold">@{account.username}</h3>
							<p class="mt-1 break-words text-xs text-muted-foreground">
								{account.displayName}{account.isAdmin
									? " · administrator"
									: ""}{account.disabledAt ? " · disabled" : ""}
							</p>
							<dl class="my-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
								<dt class="text-muted-foreground">Posts</dt>
								<dd class="text-right">{account.postCount}</dd>
								<dt class="text-muted-foreground">Messages</dt>
								<dd class="text-right">{account.messageCount}</dd>
								<dt class="text-muted-foreground">Owned media</dt>
								<dd class="text-right">{bytes(account.mediaBytes)}</dd>
								<dt class="text-muted-foreground">Last activity</dt>
								<dd class="text-right">{time(account.lastActivity)}</dd>
							</dl>
							{@render accountActions(account)}
						</article>
					{:else}{#if !sectionLoading}<p
								class="py-6 text-center text-sm text-muted-foreground"
							>
								No accounts found.
							</p>{/if}{/each}
				</div>
				<div class="kaordo-scrollbar mt-5 hidden overflow-x-auto md:block">
					<table class="w-full min-w-[800px] text-left text-sm">
						<thead
							><tr
								class="border-b border-border text-xs uppercase tracking-wider text-muted-foreground"
								><th class="py-3 pr-4">Account</th><th class="py-3 pr-4"
									>Posts</th
								><th class="py-3 pr-4">Messages</th><th class="py-3 pr-4"
									>Owned media</th
								><th class="py-3 pr-4">Last activity</th><th
									class="py-3 text-right">Actions</th
								></tr
							></thead
						><tbody
							>{#each users as account}<tr class="border-b border-border/70"
									><td class="py-3 pr-4"
										><strong>@{account.username}</strong>
										<p class="text-xs text-muted-foreground">
											{account.displayName}{account.isAdmin
												? " · administrator"
												: ""}{account.disabledAt ? " · disabled" : ""}
										</p></td
									><td class="py-3 pr-4">{account.postCount}</td><td
										class="py-3 pr-4">{account.messageCount}</td
									><td class="py-3 pr-4">{bytes(account.mediaBytes)}</td><td
										class="py-3 pr-4 text-xs text-muted-foreground"
										>{time(account.lastActivity)}</td
									><td class="py-3 text-right"
										>{@render accountActions(account)}</td
									></tr
								>{:else}<tr
									><td
										colspan="6"
										class="py-8 text-center text-muted-foreground"
										>No accounts found.</td
									></tr
								>{/each}</tbody
						>
					</table>
				</div>
			</section>
			{#if caseRecord}<section
					class="mt-6 rounded-[1.4rem] border border-primary/25 bg-card p-5 sm:p-6"
				>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p
								class="text-xs font-bold uppercase tracking-widest text-primary"
							>
								Audited access
							</p>
							<h2 class="mt-1 text-xl font-bold">
								@{caseRecord.targetUsername}
							</h2>
							<p class="mt-1 text-xs text-muted-foreground">
								Expires {time(caseRecord.expiresAt)} · Case {caseRecord.id}
							</p>
						</div>
						<Button
							variant="outline"
							disabled={busy}
							onclick={() => void closeCase()}>Close access case</Button
						>
					</div>
					<p class="mt-3 text-sm">{caseRecord.reason}</p>
					<div class="mt-5 flex gap-2">
						<Button
							variant={contentKind === "posts" ? "default" : "outline"}
							size="sm"
							onclick={() => {
								contentKind = "posts";
								void loadContent(true);
							}}>Posts</Button
						><Button
							variant={contentKind === "messages" ? "default" : "outline"}
							size="sm"
							onclick={() => {
								contentKind = "messages";
								void loadContent(true);
							}}>Sent messages</Button
						>
					</div>
					<div class="mt-5 space-y-3">
						{#each content?.items ?? [] as item}<article
								class="rounded-xl border border-border bg-background p-4"
							>
								<div
									class="flex justify-between gap-3 text-xs text-muted-foreground"
								>
									<span>{item.context}</span><time>{time(item.createdAt)}</time>
								</div>
								<p class="mt-2 whitespace-pre-wrap break-words text-sm">
									{item.text || "Media only"}
								</p>
								{#if item.media.length}<div class="mt-3 flex flex-wrap gap-2">
										{#each item.media as media}<a
												class="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-primary hover:underline"
												href={media.url}
												target="_blank"
												rel="noopener noreferrer"
												>{media.kind} · {bytes(media.size)} ↗</a
											>{/each}
									</div>{/if}
							</article>{:else}<p class="text-sm text-muted-foreground">
								No {contentKind} in this account.
							</p>{/each}
					</div>
					{#if content?.nextCursor}<Button
							class="mt-4"
							variant="outline"
							disabled={sectionLoading}
							onclick={() => void loadContent()}>Load more</Button
						>{/if}
				</section>{/if}
		{:else if tab === "Audit"}
			<section
				class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6"
			>
				<div class="flex items-center justify-between gap-3">
					<div>
						<h2 class="text-lg font-bold">Admin audit</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							The latest 100 administrator actions. Records are retained in
							PostgreSQL.
						</p>
					</div>
					<Button variant="outline" onclick={() => void loadAudit()}
						>Refresh</Button
					>
				</div>
				<div class="mt-5 divide-y divide-border">
					{#each audit as item}<div
							class="grid gap-1 py-4 text-sm sm:grid-cols-[11rem_1fr]"
						>
							<time class="text-xs text-muted-foreground"
								>{time(item.createdAt)}</time
							>
							<div>
								<p>
									<strong>@{item.actor}</strong> · {item.action}{item.target
										? ` · @${item.target}`
										: ""}
								</p>
								{#if item.reason}<p class="mt-1 text-xs text-muted-foreground">
										{item.reason}
									</p>{/if}
							</div>
						</div>{:else}<p class="py-8 text-sm text-muted-foreground">
							No administrator actions recorded yet.
						</p>{/each}
				</div>
			</section>
		{:else if tab === "System"}
			<section class="mt-6 grid gap-4 lg:grid-cols-2">
				<div class="rounded-[1.4rem] border border-border bg-card p-6">
					<p class="text-xs font-bold uppercase tracking-widest text-primary">
						NisOS host
					</p>
					<h2 class="mt-2 text-2xl font-bold">
						{system?.hostname || "Local server"}
					</h2>
					<p class="mt-2 text-sm text-muted-foreground">
						Last sample {time(system?.time)}
					</p>
					<p class="mt-3 text-sm text-muted-foreground">
						{system?.host.cpuModel || "CPU model unavailable"} · {system?.host
							.logicalCores ?? "—"} logical cores · {bytes(
							system?.host.memoryTotalBytes,
						)} RAM
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Kernel {system?.host.kernel || "—"} · Up for {system?.host
							.uptimeSeconds
							? Math.floor(system.host.uptimeSeconds / 3600)
							: "—"} hours
					</p>
					<div class="mt-5 grid grid-cols-2 gap-3">
						<div class="rounded-xl bg-secondary/60 p-4">
							<p class="text-xs text-muted-foreground">CPU</p>
							<p class="mt-2 text-xl font-bold">
								{metrics?.series.cpuPercent?.at(-1)?.value.toFixed(1) ?? "—"}%
							</p>
						</div>
						<div class="rounded-xl bg-secondary/60 p-4">
							<p class="text-xs text-muted-foreground">Memory</p>
							<p class="mt-2 text-xl font-bold">
								{metrics?.series.memoryPercent?.at(-1)?.value.toFixed(1) ??
									"—"}%
							</p>
						</div>
					</div>
				</div>
				<div class="rounded-[1.4rem] border border-border bg-card p-6">
					<h2 class="text-lg font-bold">Maintenance</h2>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						Actions run through a local allowlisted agent. Every request
						requires a reason and is written to the audit before execution.
					</p>
					<div class="mt-5 flex flex-wrap gap-2">
						<Button
							variant="outline"
							onclick={() =>
								openIntent({
									type: "action",
									id: "scrub-data",
									name: "Start Data1 scrub",
								})}>Scrub Data1</Button
						><Button
							variant="outline"
							onclick={() =>
								openIntent({
									type: "action",
									id: "restart-ddclient",
									name: "Restart dynamic DNS",
								})}>Restart DNS updater</Button
						>
					</div>
				</div>
			</section>
			<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-6">
				<h2 class="text-lg font-bold">Service controls</h2>
				<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each system?.services ?? [] as service}<div
							class="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 p-4"
						>
							<div class="min-w-0">
								<p class="truncate text-sm font-bold">{service.id}</p>
								<p class="text-xs text-muted-foreground">
									{service.active || "unknown"} · {service.substate ||
										"unknown"}
								</p>
							</div>
							{#if ["nodo", "livekit", "ddclient"].includes(service.id)}<Button
									size="xs"
									variant="outline"
									onclick={() =>
										openIntent({
											type: "action",
											id: `restart-${service.id}`,
											name: `Restart ${service.id}`,
										})}>Restart</Button
								>{/if}
						</div>{/each}
				</div>
			</section>
		{/if}
	</main>
</div>

<Dialog.Root
	open={!!intent}
	onOpenChange={(open) => {
		if (!open && !busy) intent = null;
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header
			><Dialog.Title>{intent?.name || "Confirm action"}</Dialog.Title
			><Dialog.Description
				>{intent?.type === "case"
					? "This opens a 15-minute access case, records the reason and notifies the account in Ligo Saved messages."
					: intent?.type === "status"
						? "This changes account access immediately and records your reason."
						: intent?.type === "role"
							? "Administrators can inspect account content and control services. This role change is recorded with your reason."
							: "This system operation is recorded in the administrator audit."}</Dialog.Description
			></Dialog.Header
		>
		<label class="block text-sm font-semibold" for="admin-reason">Reason</label
		><Textarea
			id="admin-reason"
			bind:value={reason}
			maxlength={500}
			rows={4}
			placeholder="Describe why this action is necessary"
		/>
		<p class="text-xs text-muted-foreground">
			{reason.trim().length}/500 characters · {intent?.type === "case"
				? "20"
				: "10"} minimum
		</p>
		<Dialog.Footer
			><Button
				variant="outline"
				disabled={busy}
				onclick={() => {
					intent = null;
				}}>Cancel</Button
			><Button
				disabled={busy ||
					reason.trim().length < (intent?.type === "case" ? 20 : 10)}
				onclick={() => void confirmIntent()}
				>{busy ? "Working…" : "Confirm"}</Button
			></Dialog.Footer
		>
		{#if actionError}<p
				class="rounded-xl border border-destructive/30 bg-destructive/7 p-3 text-sm text-destructive"
				role="alert"
			>
				{actionError}
			</p>{/if}
	</Dialog.Content>
</Dialog.Root>
