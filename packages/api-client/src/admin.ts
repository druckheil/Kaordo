// Provides typed administrative requests and cancellable Regado reads

import type {
  AdminAccessCase, AdminAuditEntry, AdminContentPage, AdminLogs, AdminMetrics,
  AdminSummary, AdminSystem, AdminUser, paths,
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

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
        params: { query: { window } }, signal,
      });
      return requireResponseData(data, error, response.status);
    },
    async users(q = '', signal?: AbortSignal): Promise<{ items: AdminUser[] }> {
      const { data, error, response } = await client.GET('/v1/admin/users', {
        params: { query: { q } }, signal,
      });
      return requireResponseData(data, error, response.status);
    },
    async setStatus(id: string, disabled: boolean, reason: string): Promise<AdminUser> {
      const { data, error, response } = await client.PATCH('/v1/admin/users/{id}/status', {
        params: { path: { id } }, body: { disabled, reason },
      });
      return requireResponseData(data, error, response.status);
    },
    async setRole(id: string, isAdmin: boolean, reason: string): Promise<AdminUser> {
      const { data, error, response } = await client.PATCH('/v1/admin/users/{id}/role', {
        params: { path: { id } }, body: { isAdmin, reason },
      });
      return requireResponseData(data, error, response.status);
    },
    async audit(signal?: AbortSignal): Promise<{ items: AdminAuditEntry[] }> {
      const { data, error, response } = await client.GET('/v1/admin/audit', { signal });
      return requireResponseData(data, error, response.status);
    },
    async createCase(targetUserId: string, reason: string): Promise<AdminAccessCase> {
      const { data, error, response } = await client.POST('/v1/admin/cases', {
        body: { targetUserId, reason },
      });
      return requireResponseData(data, error, response.status);
    },
    async closeCase(id: string): Promise<void> {
      const { error, response } = await client.POST('/v1/admin/cases/{id}/close', {
        params: { path: { id } },
      });
      requireResponseOk(response, error);
    },
    async caseContent(id: string, kind: 'posts' | 'messages', before?: string, signal?: AbortSignal): Promise<AdminContentPage> {
      const { data, error, response } = await client.GET('/v1/admin/cases/{id}/content', {
        params: { path: { id }, query: { kind, before } }, signal,
      });
      return requireResponseData(data, error, response.status);
    },
    async logs(service: string, signal?: AbortSignal): Promise<AdminLogs> {
      const { data, error, response } = await client.GET('/v1/admin/logs', {
        params: { query: { service } }, signal,
      });
      return requireResponseData(data, error, response.status);
    },
    async action(action: 'restart-nodo' | 'restart-livekit' | 'restart-ddclient' | 'scrub-data', reason: string) {
      const { data, error, response } = await client.POST('/v1/admin/actions/{action}', {
        params: { path: { action } }, body: { reason },
      });
      return requireResponseData(data, error, response.status);
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
