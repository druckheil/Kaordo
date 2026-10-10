// Defines Regado navigation, administrator intents, and display formatting

import type { AdminApi } from '@kaordo/api-client';
import type { AdminLogs, AdminLogRetentionDays } from '@kaordo/contracts';

export const dashboardTabs = [
	'Overview',
	'Storage',
	'Usage',
	'Deployments',
	'Logs',
	'Users',
	'Audit',
	'System'
] as const;

export type DashboardTab = (typeof dashboardTabs)[number];
export const metricsWindows = ['1h', '24h', '7d'] as const;
export type MetricsWindow = (typeof metricsWindows)[number];
export const logPriorities = [
	{ value: 'all', label: 'All' },
	{ value: '3', label: 'Errors' },
	{ value: '4', label: 'Warnings' },
	{ value: '6', label: 'Info' }
] as const;
export type LogPriority = (typeof logPriorities)[number]['value'];
type AdminSystemAction = Parameters<AdminApi['action']>[0];
export const restartActions = {
	nodo: 'restart-nodo',
	livekit: 'restart-livekit',
	ddclient: 'restart-ddclient'
} as const;

export type RestartableService = keyof typeof restartActions;

export type AdminIntent =
	| { type: 'log-retention'; days: AdminLogRetentionDays; name: string }
	| { type: 'status'; id: string; name: string; disabled: boolean }
	| { type: 'role'; id: string; name: string; isAdmin: boolean }
	| { type: 'action'; id: AdminSystemAction; name: string };

export const logServices = [
	'kerno',
	'nodo',
	'keycloak',
	'postgresql',
	'caddy',
	'livekit',
	'ddclient',
	'prometheus',
	'prometheus-node-exporter',
	'regado-agent'
] as const;

export const logRetentionOptions = [
	{ days: 1, label: '1 day' },
	{ days: 7, label: '7 days' },
	{ days: 14, label: '14 days' },
	{ days: 30, label: '30 days' },
	{ days: 90, label: '90 days' },
	{ days: 0, label: 'Size limit only' }
] as const satisfies readonly { days: AdminLogRetentionDays; label: string }[];

export function isRefreshableTab(tab: DashboardTab): boolean {
	return tab === 'Overview' || tab === 'Storage' || tab === 'System';
}

export function isRestartableService(service: string): service is RestartableService {
	return Object.hasOwn(restartActions, service);
}

export function formatBytes(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return '—';

	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let count = value;
	let unitIndex = 0;
	while (count >= 1024 && unitIndex < units.length - 1) {
		count /= 1024;
		unitIndex++;
	}

	return `${count.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDateTime(value: string | null | undefined): string {
	return value ? new Date(value).toLocaleString() : '—';
}

export function formatLogTime(value: string): string {
	const microseconds = Number(value);
	if (!Number.isFinite(microseconds) || microseconds <= 0) return '—';

	return new Date(microseconds / 1000).toLocaleString();
}

export function filterLogs(logs: AdminLogs | null, priority: LogPriority, search: string) {
	const normalizedSearch = search.toLowerCase();
	return (logs?.items ?? []).filter((item) => {
		const matchesPriority = priority === 'all' || item.priority === priority;
		const matchesSearch = item.message.toLowerCase().includes(normalizedSearch);
		return matchesPriority && matchesSearch;
	});
}

export function intentDescription(intent: AdminIntent | null): string {
	switch (intent?.type) {
		case 'log-retention':
			return "This changes the host's desired journal retention, which the agent then applies. Older archived logs may be permanently removed; the disk-space budget still applies. Your reason is recorded with the change.";
		case 'status':
			return 'This changes account access immediately and records your reason.';
		case 'role':
			return 'Administrators can manage accounts and control services. This role change is recorded with your reason.';
		case 'action':
			if (intent.id === 'restart-ddclient') {
				return 'This runs one DNS check and starts the automatic update timer if necessary. The updater exits after each check; a scheduled idle service is healthy.';
			}
			if (intent.id === 'check-media') {
				return 'This counts stored media and checks each expired upload against its references. Nothing is removed. The check is recorded in the administrator audit.';
			}
			if (intent.id === 'clean-media') {
				return 'This removes uploads older than 24 hours that nothing references, then checks again. Files whose references cannot be verified are kept. The cleanup is recorded in the administrator audit.';
			}
			return 'This system operation is recorded in the administrator audit.';
		default:
			return '';
	}
}

export function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : 'The request failed.';
}
