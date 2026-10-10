<script lang="ts">
	// Composes Regado query resources, navigation and dashboard panels

	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery, QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import {
		createAdminApi,
		adminSummaryOptions,
		adminSystemOptions,
		adminHostOptions,
		adminHostAlertsOptions,
		adminMetricsOptions,
		adminUsersOptions,
		adminAuditOptions,
		adminLogsOptions
	} from '@kaordo/api-client';
	import type { AdminSystem, UserIdentity } from '@kaordo/contracts';
	import { appPaths } from '@kaordo/links';
	import { AppHeader, Button } from '@kaordo/ui';
	import AdminIntentDialog from './AdminIntentDialog.svelte';
	import AuditPanel from './AuditPanel.svelte';
	import LogsPanel from './LogsPanel.svelte';
	import OverviewPanel from './OverviewPanel.svelte';
	import StorageView from './storage/StorageView.svelte';
	import SystemPanel from './SystemPanel.svelte';
	import UsersPanel from './UsersPanel.svelte';
	import { createAdminActionState } from './admin-action-state.svelte';
	import {
		dashboardTabs as tabs,
		errorMessage,
		isRefreshableTab,
		logServices,
		type DashboardTab as Tab,
		type LogPriority,
		type MetricsWindow
	} from './regado-model';

	let { user }: { user: UserIdentity } = $props();
	const api = createAdminApi(
		import.meta.env.VITE_KAORDO_API_URL ||
			(typeof window !== 'undefined' ? window.location.origin : '')
	);

	const tab = $derived<Tab>(
		tabs.find((item) => item.toLowerCase() === page.url.searchParams.get('view')) ?? 'Overview'
	);
	let timeWindow = $state<MetricsWindow>('1h');
	let search = $state('');
	let submittedSearch = $state('');
	let logService = $state<string>(logServices[0]);
	let logLevel = $state<LogPriority>('all');
	let logSearch = $state('');

	const queryClient = new QueryClient();

	const commands = createAdminActionState({
		api,
		queryClient,
		refreshOverview,
		loadUsers
	});
	const { form, status } = commands;
	const busy = $derived(status.busy);
	const notice = $derived(status.notice);
	const refreshable = $derived(isRefreshableTab(tab));
	const overviewPolicy = $derived({
		enabled: refreshable,
		refetchInterval: refreshable ? 30_000 : (false as const)
	});
	const summaryQuery = createQuery(
		() => ({ ...adminSummaryOptions(api), ...overviewPolicy }),
		() => queryClient
	);
	const systemQuery = createQuery(
		() => ({
			...adminSystemOptions(api),
			enabled: refreshable,
			// A running media check reports progress; poll it closely until it settles
			refetchInterval: (query: { state: { data?: AdminSystem } }) =>
				!refreshable
					? false
					: ['checking', 'repairing'].includes(query.state.data?.mediaMaintenance?.state ?? '')
						? 5_000
						: 30_000
		}),
		() => queryClient
	);
	// Shares the Storage view's cache entry, so switching tabs shows the last facts at once
	const hostQuery = createQuery(
		() => ({ ...adminHostOptions(api, 'local', false), enabled: tab === 'Overview' }),
		() => queryClient
	);
	const alertsQuery = createQuery(
		() => ({ ...adminHostAlertsOptions(api, 'local'), enabled: tab === 'Overview' }),
		() => queryClient
	);
	const metricsQuery = createQuery(
		() => ({ ...adminMetricsOptions(api, timeWindow), ...overviewPolicy }),
		() => queryClient
	);
	const usersQuery = createQuery(
		() => ({ ...adminUsersOptions(api, submittedSearch), enabled: tab === 'Users' }),
		() => queryClient
	);
	const auditQuery = createQuery(
		() => ({ ...adminAuditOptions(api), enabled: tab === 'Audit' }),
		() => queryClient
	);
	const logsQuery = createQuery(
		() => ({
			...adminLogsOptions(api, logService),
			enabled: tab === 'Logs',
			refetchInterval: tab === 'Logs' ? 30_000 : false
		}),
		() => queryClient
	);

	const summary = $derived(summaryQuery.data ?? null);
	const system = $derived(systemQuery.data ?? null);
	const metrics = $derived(metricsQuery.data ?? null);
	const users = $derived(usersQuery.data?.items ?? []);
	const audit = $derived(auditQuery.data?.items ?? []);
	const logs = $derived(logsQuery.data ?? null);
	const loading = $derived(
		summaryQuery.isPending || systemQuery.isPending || metricsQuery.isPending
	);
	const sectionLoading = $derived(
		tab === 'Users'
			? usersQuery.isFetching
			: tab === 'Logs'
				? logsQuery.isFetching
				: tab === 'Audit' && auditQuery.isFetching
	);
	const sectionError = $derived.by(() => {
		if (refreshable) return summaryQuery.error ?? systemQuery.error ?? metricsQuery.error;
		if (tab === 'Users') return usersQuery.error;
		if (tab === 'Logs') return logsQuery.error;
		if (tab === 'Audit') return auditQuery.error;
		return null;
	});
	const error = $derived(status.operationError || (sectionError ? errorMessage(sectionError) : ''));

	onDestroy(() => {
		commands.dispose();
		void queryClient.cancelQueries();
		queryClient.clear();
	});

	function openTab(next: Tab): void {
		commands.clearOperationError();
		const url = new URL(page.url);
		url.searchParams.set('view', next.toLowerCase());
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- The URL clones the resolved current page and changes only its query
		void goto(url, { noScroll: true, keepFocus: true });
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
</script>

<svelte:head><title>{tab} | Regado | Kaordo</title></svelte:head>

<QueryClientProvider client={queryClient}>
	<div
		class="min-h-dvh bg-[radial-gradient(circle_at_90%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_38%)]"
	>
		<AppHeader name="Regado" homeHref={appPaths.portal} sticky wide>
			{#snippet actions()}<span
					class="mr-2 hidden max-w-40 truncate text-xs text-muted-foreground md:inline"
					>@{user.username}</span
				>{/snippet}
		</AppHeader>

		<main
			id="main-content"
			tabindex="-1"
			class="mx-auto max-w-7xl px-4 pt-7 pb-16 sm:px-8 sm:pt-10"
		>
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p class="text-xs font-bold tracking-[0.2em] text-link uppercase">Local operations</p>
					<h1 class="mt-1 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
						{tab === 'Overview' ? 'System overview' : tab}
					</h1>
					<p class="mt-2 text-sm text-muted-foreground">
						Live service health, dynamically discovered storage and accountable administration.
					</p>
				</div>
				<Button variant="outline" onclick={() => void refreshOverview()} disabled={loading}
					>Refresh data</Button
				>
			</div>
			<nav
				class="mt-7 grid grid-cols-3 gap-1 border-b border-border sm:flex"
				aria-label="Regado sections"
			>
				{#each tabs as item (item)}
					<button
						type="button"
						onclick={() => openTab(item)}
						aria-current={tab === item ? 'page' : undefined}
						class={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-ring ${tab === item ? 'border-primary text-link' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
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

			{#if tab === 'Overview'}
				<OverviewPanel
					{summary}
					{system}
					facts={hostQuery.data ?? null}
					openAlerts={alertsQuery.data?.alerts.filter((alert) => !alert.resolvedAt).length ?? 0}
					{metrics}
					{loading}
					bind:timeWindow
					onWindowChange={(window: MetricsWindow) => (timeWindow = window)}
				/>
			{:else if tab === 'Storage'}
				<StorageView
					{api}
					{queryClient}
					viewerId={user.id}
					media={system?.mediaMaintenance ?? null}
					mediaDisabled={busy}
					onMediaAction={commands.requestMediaAction}
				/>
			{:else if tab === 'Logs'}
				<LogsPanel
					{logs}
					loading={sectionLoading}
					bind:service={logService}
					bind:priority={logLevel}
					bind:search={logSearch}
					onRefresh={loadLogs}
					{busy}
					onRetentionChange={(days: import('@kaordo/contracts').AdminLogRetentionDays) =>
						commands.openIntent({ type: 'log-retention', days, name: 'Change journal retention' })}
				/>
			{:else if tab === 'Users'}
				<UsersPanel
					{users}
					bind:search
					{sectionLoading}
					currentUserId={user.id}
					onSearch={loadUsers}
					onIntent={commands.openIntent}
				/>
			{:else if tab === 'Audit'}
				<AuditPanel entries={audit} loading={sectionLoading} onRefresh={loadAudit} />
			{:else if tab === 'System'}
				<SystemPanel
					{system}
					{metrics}
					onRestartDns={commands.requestDnsRestart}
					onRestartService={commands.requestServiceRestart}
				/>
			{/if}
		</main>
	</div>

	<AdminIntentDialog
		intent={form.intent}
		bind:reason={form.reason}
		{busy}
		error={status.actionError}
		onConfirm={() => void commands.confirmIntent()}
		onClose={() => (form.intent = null)}
	/>
</QueryClientProvider>
