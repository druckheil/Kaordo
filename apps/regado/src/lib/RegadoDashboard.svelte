<script lang="ts">
	// Coordinates Regado data loading, administrative actions, and dashboard panels

	import { onDestroy } from "svelte";
	import { createQuery, createInfiniteQuery, QueryClient } from "@tanstack/svelte-query";
	import {
		createAdminApi, adminSummaryOptions, adminSystemOptions, adminMetricsOptions,
		adminUsersOptions, adminAuditOptions, adminLogsOptions, adminCaseContentOptions,
	} from "@kaordo/api-client";
	import type { AdminAccessCase, AdminDisk, AdminMount, AdminLayoutRequest, UserIdentity } from "@kaordo/contracts";
	import { appPaths } from "@kaordo/links";
	import { ArrowUpRightIcon, Button, ShieldCheckIcon, ThemeToggle } from "@kaordo/ui";
	import AdminIntentDialog from "./AdminIntentDialog.svelte";
	import AuditPanel from "./AuditPanel.svelte";
	import LogsPanel from "./LogsPanel.svelte";
	import OverviewPanel from "./OverviewPanel.svelte";
	import StoragePanel from "./StoragePanel.svelte";
	import SystemPanel from "./SystemPanel.svelte";
	import UsersPanel from "./UsersPanel.svelte";
	import {
		dashboardTabs as tabs,
		errorMessage,
		isRefreshableTab,
		logServices,
		restartActions,
		type AdminIntent,
		type ContentKind,
		type DashboardTab as Tab,
		type LogPriority,
		type MetricsWindow,
		type RestartableService,
	} from "./regado-model";

	let { user }: { user: UserIdentity } = $props();
	const api = createAdminApi(
		import.meta.env.VITE_KAORDO_API_URL ||
			(typeof window !== "undefined" ? window.location.origin : ""),
	);

	let tab = $state<Tab>("Overview");
	let timeWindow = $state<MetricsWindow>("1h");
	let search = $state("");
	let submittedSearch = $state("");
	let logService = $state<string>(logServices[0]);
	let logLevel = $state<LogPriority>("all");
	let logSearch = $state("");
	let caseRecord = $state<AdminAccessCase | null>(null);
	let contentKind = $state<ContentKind>("posts");
	let operationError = $state("");
	let actionError = $state("");
	let notice = $state("");
	let busy = $state(false);
	let intent = $state<AdminIntent | null>(null);
	let reason = $state("");
	let confirmation = $state("");

	const queryClient = new QueryClient();
	const refreshable = $derived(isRefreshableTab(tab));
	const overviewPolicy = $derived({ enabled: refreshable, refetchInterval: refreshable ? 30_000 : false as const });
	const summaryQuery = createQuery(() => ({ ...adminSummaryOptions(api), ...overviewPolicy }), () => queryClient);
	const systemQuery = createQuery(() => ({
		...adminSystemOptions(api), enabled: refreshable,
		refetchInterval: (query) => {
			if (!refreshable) return false;
			const data = query.state.data;
			const running = data?.layoutReports?.some((report) => report.state === "running") || data?.replicationReports?.some((report) => report.state === "checking" || report.state === "repairing") || data?.mediaMaintenance?.state === "checking" || data?.mediaMaintenance?.state === "repairing";
			return running ? 2_000 : 30_000;
		},
	}), () => queryClient);
	const metricsQuery = createQuery(() => ({ ...adminMetricsOptions(api, timeWindow), ...overviewPolicy }), () => queryClient);
	const usersQuery = createQuery(() => ({ ...adminUsersOptions(api, submittedSearch), enabled: tab === "Users" }), () => queryClient);
	const auditQuery = createQuery(() => ({ ...adminAuditOptions(api), enabled: tab === "Audit" }), () => queryClient);
	const logsQuery = createQuery(() => ({ ...adminLogsOptions(api, logService), enabled: tab === "Logs", refetchInterval: tab === "Logs" ? 30_000 : false }), () => queryClient);
	const contentQuery = createInfiniteQuery(() => ({
		...adminCaseContentOptions(api, caseRecord?.id ?? null, contentKind),
		enabled: !!caseRecord && tab === "Users",
	}), () => queryClient);

	const summary = $derived(summaryQuery.data ?? null);
	const system = $derived(systemQuery.data ?? null);
	const metrics = $derived(metricsQuery.data ?? null);
	const users = $derived(usersQuery.data?.items ?? []);
	const audit = $derived(auditQuery.data?.items ?? []);
	const logs = $derived(logsQuery.data ?? null);
	const content = $derived(contentQuery.data ? {
		items: contentQuery.data.pages.flatMap((page) => page.items),
		nextCursor: contentQuery.data.pages.at(-1)?.nextCursor ?? null,
	} : null);
	const loading = $derived(summaryQuery.isPending || systemQuery.isPending || metricsQuery.isPending);
	const sectionLoading = $derived(tab === "Users" ? usersQuery.isFetching : tab === "Logs" ? logsQuery.isFetching : tab === "Audit" && auditQuery.isFetching);
	const sectionError = $derived.by(() => {
		if (refreshable) return summaryQuery.error ?? systemQuery.error ?? metricsQuery.error;
		if (tab === "Users") return usersQuery.error ?? (caseRecord ? contentQuery.error : null);
		if (tab === "Logs") return logsQuery.error;
		if (tab === "Audit") return auditQuery.error;
		return null;
	});
	const error = $derived(operationError || (sectionError ? errorMessage(sectionError) : ""));

	onDestroy(() => queryClient.clear());

	function openTab(next: Tab): void {
		operationError = "";
		tab = next;
	}

	async function refreshOverview(): Promise<void> {
		await Promise.all([summaryQuery.refetch(), systemQuery.refetch(), metricsQuery.refetch()]);
	}

	async function loadUsers(): Promise<void> {
		const next = search.trim();
		if (next === submittedSearch) await usersQuery.refetch();
		else submittedSearch = next;
	}

	async function loadAudit(): Promise<void> {
		await auditQuery.refetch();
	}

	async function loadLogs(): Promise<void> {
		await logsQuery.refetch();
	}

	async function loadContent(): Promise<void> {
		if (caseRecord && contentQuery.hasNextPage && !contentQuery.isFetching) await contentQuery.fetchNextPage();
	}

	async function closeCase(): Promise<void> {
		if (!caseRecord || busy) return;
		busy = true;
		try {
			await api.closeCase(caseRecord.id);
			caseRecord = null;
			queryClient.removeQueries({ queryKey: ["regado", "case"] });
			notice = "Access case closed.";
			operationError = "";
		} catch (cause) {
			operationError = errorMessage(cause);
		} finally {
			busy = false;
		}
	}

	function openIntent(next: AdminIntent): void {
		intent = next;
		reason = "";
		confirmation = "";
		actionError = "";
		notice = "";
	}

	async function requestCopyCheck(path: string): Promise<void> {
		if (busy) return;
		busy = true;
		operationError = "";
		try {
			const result = await api.action("check-storage", "Verify file copies, checksums and expired upload references", { target: path });
			notice = result.output;
			await refreshOverview();
		} catch (cause) { operationError = errorMessage(cause); }
		finally { busy = false; }
	}

 async function applyStorageLayout(body: AdminLayoutRequest & { fingerprint: string; confirmation: string; reason: string }): Promise<void> {
  const result = await api.applyStorageLayout(body);
  notice = result.output;
  await refreshOverview();
 }

	function requestCopyRepair(path: string): void {
		openIntent({
			type: "action",
			id: "repair-storage",
			name: `Repair file copies in ${path}`,
			target: path,
		});
		reason = "Restore two-copy storage and remove expired unreferenced uploads";
	}

	function requestDnsRestart(): void {
		openIntent({
			type: "action",
			id: "restart-ddclient",
			name: "Update DNS now",
		});
	}

	function requestServiceRestart(serviceId: RestartableService): void {
		openIntent({
			type: "action",
			id: restartActions[serviceId],
			name: serviceId === "ddclient" ? "Update DNS now" : `Restart ${serviceId}`,
		});
	}

	async function confirmIntent(): Promise<void> {
		const selectedIntent = intent;
		if (!selectedIntent || busy) return;

		busy = true;
		actionError = "";
		operationError = "";
		notice = "";
		try {
			await performIntent(selectedIntent);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["regado", "summary"] }),
				queryClient.invalidateQueries({ queryKey: ["regado", "audit"] }),
			]);
			intent = null;
		} catch (cause) {
			actionError = errorMessage(cause);
		} finally {
			busy = false;
		}
	}

	async function performIntent(selected: AdminIntent): Promise<void> {
		switch (selected.type) {
			case "log-retention": {
				const result = await api.setLogRetention(selected.days, reason);
				notice = result.warning || "Journal retention updated.";
				await queryClient.invalidateQueries({ queryKey: ["regado", "logs"] });
				return;
			}
			case "status":
				await api.setStatus(selected.id, selected.disabled, reason);
				notice = `${selected.name} ${selected.disabled ? "disabled" : "enabled"}.`;
				await loadUsers();
				return;
			case "role":
				await api.setRole(selected.id, selected.isAdmin, reason);
				notice = `Administrator role ${selected.isAdmin ? "granted to" : "revoked from"} @${selected.name}.`;
				await loadUsers();
				return;
			case "case": {
				const createdCase = await api.createCase(selected.id, reason);
				caseRecord = createdCase;
				contentKind = "posts";
				notice = `Access case opened for @${createdCase.targetUsername}. The account was notified in Ligo Saved messages.`;
				return;
			}
			case "action":
				const result = await api.action(selected.id, reason, {
					target: selected.target,
					identity: selected.identity,
					filesystem: selected.filesystem,
				});
				notice = result.output || `${selected.name} requested.`;
				await refreshOverview();
		}
	}
</script>

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
			<div class="flex min-w-0 items-center gap-2 sm:gap-3">
				<span
					class="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground"
					><ShieldCheckIcon class="size-5" /></span
				>
				<div>
					<p class="text-sm font-bold tracking-tight">Regado</p>
					<p class="hidden text-xs text-muted-foreground min-[400px]:block">Kaordo administration</p>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2 text-sm sm:gap-4">
				<span class="hidden text-muted-foreground sm:inline"
					>@{user.username}</span
				>
				<Button href={appPaths.portal} variant="ghost" size="sm">
					All apps <ArrowUpRightIcon class="size-4" />
				</Button>
				<ThemeToggle />
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
					Live service health, dynamically discovered storage and accountable administration.
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
			<OverviewPanel
				{summary}
				{system}
				{metrics}
				{loading}
				bind:timeWindow
				onWindowChange={(window) => (timeWindow = window)}
			/>
		{:else if tab === "Storage"}
			<StoragePanel
				{system}
				{summary}
				{metrics}
				actionBusy={busy}
				onCheckCopies={(path) => void requestCopyCheck(path)}
				onRepairCopies={requestCopyRepair}
    onPreviewLayout={(body, signal) => api.previewStorageLayout(body, signal)}
    onApplyLayout={applyStorageLayout}
			/>
		{:else if tab === "Logs"}
			<LogsPanel
				{logs}
				loading={sectionLoading}
				bind:service={logService}
				bind:priority={logLevel}
				bind:search={logSearch}
				onRefresh={loadLogs}
				{busy}
				onRetentionChange={(days) => openIntent({ type: "log-retention", days, name: "Change journal retention" })}
			/>
		{:else if tab === "Users"}
			<UsersPanel
				{users}
				bind:search
				{sectionLoading}
				contentLoading={contentQuery.isFetching}
				currentUserId={user.id}
				onSearch={loadUsers}
				onIntent={openIntent}
				{caseRecord}
				{busy}
				onCloseCase={closeCase}
				bind:contentKind
				{content}
				onLoadContent={loadContent}
			/>
		{:else if tab === "Audit"}
			<AuditPanel entries={audit} loading={sectionLoading} onRefresh={loadAudit} />
		{:else if tab === "System"}
			<SystemPanel
				{system}
				{metrics}
				onRestartDns={requestDnsRestart}
				onRestartService={requestServiceRestart}
				onOpenStorage={() => openTab("Storage")}
			/>
		{/if}
	</main>
</div>

<AdminIntentDialog
	{intent}
	bind:reason
	bind:confirmation
	{busy}
	error={actionError}
	onConfirm={() => void confirmIntent()}
	onClose={() => (intent = null)}
/>
