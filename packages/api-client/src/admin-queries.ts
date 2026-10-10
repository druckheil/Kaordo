// Defines independent, cancellable Regado cache entries

import type { AdminApi } from './admin.ts';
import type { Deployment } from '@kaordo/contracts';

const readPolicy = { staleTime: 15_000, retry: false } as const;
interface ReadContext {
	signal: AbortSignal;
}

export function adminDeploymentsOptions(api: AdminApi, host: string) {
	return {
		...readPolicy,
		staleTime: 2_000,
		refetchInterval: 5_000,
		queryKey: ['regado', 'hosts', host, 'deployments'] as const,
		queryFn: ({ signal }: ReadContext) => api.deployments(host, signal)
	};
}

export function adminDeploymentOptions(api: AdminApi, host: string, run: number, attempt = 0) {
	return {
		...readPolicy,
		staleTime: 2_000,
		queryKey: ['regado', 'hosts', host, 'deployments', run, attempt] as const,
		queryFn: ({ signal }: ReadContext) => api.deployment(host, run, signal),
		refetchInterval: (query: { state: { data?: Deployment } }) =>
			!query.state.data || ['waiting', 'deploying'].includes(query.state.data.state) ? 5_000 : false
	};
}

export function adminSummaryOptions(api: AdminApi) {
	return {
		...readPolicy,
		queryKey: ['regado', 'summary'] as const,
		queryFn: ({ signal }: ReadContext) => api.summary(signal)
	};
}

export function adminSystemOptions(api: AdminApi) {
	return {
		...readPolicy,
		queryKey: ['regado', 'system'] as const,
		queryFn: ({ signal }: ReadContext) => api.system(signal)
	};
}

export function adminMetricsOptions(api: AdminApi, window: '1h' | '24h' | '7d') {
	return {
		...readPolicy,
		queryKey: ['regado', 'metrics', window] as const,
		queryFn: ({ signal }: ReadContext) => api.metrics(window, signal)
	};
}

export function adminUsersOptions(api: AdminApi, search: string) {
	return {
		...readPolicy,
		queryKey: ['regado', 'users', search] as const,
		queryFn: ({ signal }: ReadContext) => api.users(search, signal)
	};
}

export function adminAuditOptions(api: AdminApi) {
	return {
		...readPolicy,
		queryKey: ['regado', 'audit'] as const,
		queryFn: ({ signal }: ReadContext) => api.audit(signal)
	};
}

export function adminLogsOptions(api: AdminApi, service: string) {
	return {
		...readPolicy,
		queryKey: ['regado', 'logs', service] as const,
		queryFn: ({ signal }: ReadContext) => api.logs(service, signal)
	};
}

// Host facts refresh quickly while an operation is converging the host
export function adminHostOptions(api: Pick<AdminApi, 'host'>, host: string, active: boolean) {
	return {
		...readPolicy,
		staleTime: 5_000,
		refetchInterval: active ? 5_000 : 30_000,
		queryKey: ['regado', 'hosts', host, 'facts'] as const,
		queryFn: ({ signal }: ReadContext) => api.host(host, signal)
	};
}

export function adminHostAlertsOptions(api: AdminApi, host: string) {
	return {
		...readPolicy,
		staleTime: 10_000,
		refetchInterval: 60_000,
		queryKey: ['regado', 'hosts', host, 'alerts'] as const,
		queryFn: ({ signal }: ReadContext) => api.hostAlerts(host, signal)
	};
}

// Storage is measured hourly; a requested measurement is followed closely until it lands
export function adminHostUsageOptions(
	api: AdminApi,
	host: string,
	window: '1d' | '7d' | '30d' | '90d'
) {
	return {
		...readPolicy,
		queryKey: ['regado', 'hosts', host, 'usage', window] as const,
		queryFn: ({ signal }: ReadContext) => api.hostUsage(host, window, signal),
		refetchInterval: (query: { state: { data?: { measuring: boolean } } }) =>
			query.state.data?.measuring ? 5_000 : 60_000
	};
}

export function adminDataUsageOptions(api: AdminApi) {
	return {
		...readPolicy,
		refetchInterval: 60_000,
		queryKey: ['regado', 'usage'] as const,
		queryFn: ({ signal }: ReadContext) => api.dataUsage(signal)
	};
}

export function adminHostOperationsOptions(api: AdminApi, host: string, limit = 50) {
	return {
		...readPolicy,
		staleTime: 2_000,
		queryKey: ['regado', 'hosts', host, 'operations', limit] as const,
		queryFn: ({ signal }: ReadContext) => api.hostOperations(host, limit, signal),
		refetchInterval: 5_000
	};
}

export function adminHostOperationOptions(api: AdminApi, host: string, operation: string) {
	return {
		...readPolicy,
		queryKey: ['regado', 'hosts', host, 'operations', 'detail', operation] as const,
		queryFn: ({ signal }: ReadContext) => api.hostOperation(host, operation, signal)
	};
}
