// Provides typed administrative requests and cancellable Regado reads

import type {
	AdminAuditEntry,
	AdminLogs,
	AdminJournal,
	AdminLogRetentionDays,
	AdminMetrics,
	AdminSummary,
	AdminSystem,
	AdminUser,
	HostFacts,
	HostOperation,
	HostOperationRecord,
	HostPoolPlan,
	HostState,
	HostStateChange,
	HostStateChangeResult,
	HostCheckRequest,
	HostAlert,
	HostAlertTest,
	paths
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, sessionFetch } from './http.ts';

export function createAdminApi(apiBaseUrl: string, fetcher: typeof fetch = sessionFetch) {
	const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: fetcher });

	return {
		async summary(signal?: AbortSignal): Promise<AdminSummary> {
			const { data, error, response } = await client.GET('/v1/admin/summary', { signal });
			return requireResponseData(data, error, response.status);
		},
		async system(signal?: AbortSignal): Promise<AdminSystem> {
			const { data, error, response } = await client.GET('/v1/admin/system', { signal });
			return requireResponseData(data, error, response.status);
		},
		async metrics(window: '1h' | '24h' | '7d', signal?: AbortSignal): Promise<AdminMetrics> {
			const { data, error, response } = await client.GET('/v1/admin/metrics', {
				params: { query: { window } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async users(q = '', signal?: AbortSignal): Promise<{ items: AdminUser[] }> {
			const { data, error, response } = await client.GET('/v1/admin/users', {
				params: { query: { q } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async setStatus(
			id: string,
			disabled: boolean,
			reason: string,
			signal?: AbortSignal
		): Promise<AdminUser> {
			const { data, error, response } = await client.PATCH('/v1/admin/users/{id}/status', {
				params: { path: { id } },
				body: { disabled, reason },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async setRole(
			id: string,
			isAdmin: boolean,
			reason: string,
			signal?: AbortSignal
		): Promise<AdminUser> {
			const { data, error, response } = await client.PATCH('/v1/admin/users/{id}/role', {
				params: { path: { id } },
				body: { isAdmin, reason },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async audit(signal?: AbortSignal): Promise<{ items: AdminAuditEntry[] }> {
			const { data, error, response } = await client.GET('/v1/admin/audit', { signal });
			return requireResponseData(data, error, response.status);
		},
		async logs(service: string, signal?: AbortSignal): Promise<AdminLogs> {
			const { data, error, response } = await client.GET('/v1/admin/logs', {
				params: { query: { service } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async setLogRetention(
			retentionDays: AdminLogRetentionDays,
			reason: string,
			signal?: AbortSignal
		): Promise<AdminJournal> {
			const { data, error, response } = await client.PATCH('/v1/admin/logs/retention', {
				body: { retentionDays, reason },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async action(
			action: paths['/v1/admin/actions/{action}']['post']['parameters']['path']['action'],
			reason: string,
			signal?: AbortSignal
		) {
			const { data, error, response } = await client.POST('/v1/admin/actions/{action}', {
				params: { path: { action } },
				body: { reason },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async host(host: string, signal?: AbortSignal): Promise<HostFacts> {
			const { data, error, response } = await client.GET('/v1/admin/hosts/{host}', {
				params: { path: { host } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async planHostState(
			host: string,
			document: HostState,
			signal?: AbortSignal
		): Promise<HostPoolPlan> {
			const { data, error, response } = await client.POST('/v1/admin/hosts/{host}/state/plan', {
				params: { path: { host } },
				body: document,
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async applyHostState(
			host: string,
			change: HostStateChange,
			signal?: AbortSignal
		): Promise<HostStateChangeResult> {
			const { data, error, response } = await client.PUT('/v1/admin/hosts/{host}/state', {
				params: { path: { host } },
				body: change,
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async hostOperations(
			host: string,
			limit: number,
			signal?: AbortSignal
		): Promise<{ items: HostOperation[] }> {
			const { data, error, response } = await client.GET('/v1/admin/hosts/{host}/operations', {
				params: { path: { host }, query: { limit } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async hostOperation(
			host: string,
			operation: string,
			signal?: AbortSignal
		): Promise<HostOperationRecord> {
			const { data, error, response } = await client.GET(
				'/v1/admin/hosts/{host}/operations/{operation}',
				{
					params: { path: { host, operation } },
					signal
				}
			);
			return requireResponseData(data, error, response.status);
		},
		async hostAlerts(host: string, signal?: AbortSignal): Promise<{ alerts: HostAlert[] }> {
			const { data, error, response } = await client.GET('/v1/admin/hosts/{host}/alerts', {
				params: { path: { host } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async testHostAlerts(host: string, signal?: AbortSignal): Promise<HostAlertTest> {
			const { data, error, response } = await client.POST('/v1/admin/hosts/{host}/alerts/test', {
				params: { path: { host } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async startHostCheck(
			host: string,
			check: HostCheckRequest,
			signal?: AbortSignal
		): Promise<HostOperation> {
			const { data, error, response } = await client.POST('/v1/admin/hosts/{host}/operations', {
				params: { path: { host } },
				body: check,
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async cancelHostOperation(
			host: string,
			operation: string,
			signal?: AbortSignal
		): Promise<HostOperation> {
			const { data, error, response } = await client.POST(
				'/v1/admin/hosts/{host}/operations/{operation}/cancel',
				{ params: { path: { host, operation } }, signal }
			);
			return requireResponseData(data, error, response.status);
		}
	};
}

export type AdminApi = ReturnType<typeof createAdminApi>;
