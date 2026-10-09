// Defines independent, cancellable Regado cache entries

import type { AdminApi } from './admin.ts';

const readPolicy = { staleTime: 15_000, retry: false } as const;
type ReadContext = { signal: AbortSignal };

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
