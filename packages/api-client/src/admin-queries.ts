// Defines independent, cancellable Regado cache entries

import type { AdminApi } from './admin.ts';

const readPolicy = { staleTime: 15_000, retry: false } as const;
interface ReadContext {
	signal: AbortSignal;
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
export function adminHostOptions(api: AdminApi, host: string, active: boolean) {
	return {
		...readPolicy,
		staleTime: 5_000,
		refetchInterval: active ? 3_000 : 30_000,
		queryKey: ['regado', 'hosts', host, 'facts'] as const,
		queryFn: ({ signal }: ReadContext) => api.host(host, signal)
	};
}

export function adminHostOperationsOptions(api: AdminApi, host: string, limit = 50) {
	return {
		...readPolicy,
		staleTime: 2_000,
		queryKey: ['regado', 'hosts', host, 'operations', limit] as const,
		queryFn: ({ signal }: ReadContext) => api.hostOperations(host, limit, signal),
		refetchInterval: (query: { state: { data?: { items: { state: string }[] } } }) =>
			query.state.data?.items.some((item) => item.state === 'queued' || item.state === 'running')
				? 1_500
				: 30_000
	};
}

export function adminHostOperationOptions(api: AdminApi, host: string, operation: string) {
	return {
		...readPolicy,
		queryKey: ['regado', 'hosts', host, 'operations', 'detail', operation] as const,
		queryFn: ({ signal }: ReadContext) => api.hostOperation(host, operation, signal)
	};
}
