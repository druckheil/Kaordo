// Provides typed administrative requests and cancellable Regado reads

import type {
  AdminAccessCase, AdminAuditEntry, AdminContentPage, AdminLogs, AdminJournal, AdminLogRetentionDays, AdminMetrics,
  AdminSummary, AdminSystem, AdminUser, AdminStoragePlan, AdminLayoutRequest, paths,
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
    async setLogRetention(retentionDays: AdminLogRetentionDays, reason: string): Promise<AdminJournal> {
      const { data, error, response } = await client.PATCH('/v1/admin/logs/retention', {
        body: { retentionDays, reason },
      });
      return requireResponseData(data, error, response.status);
    },
    async previewStorageLayout(body: AdminLayoutRequest, signal?: AbortSignal): Promise<AdminStoragePlan> {
      const { data, error, response } = await client.POST('/v1/admin/storage/plan', { body, signal });
      return requireResponseData(data, error, response.status);
    },
    async applyStorageLayout(body: AdminLayoutRequest & { reason: string; fingerprint: string; confirmation: string }) {
      const { data, error, response } = await client.POST('/v1/admin/storage/apply', { body });
      return requireResponseData(data, error, response.status);
    },
    async action(
      action: 'restart-nodo' | 'restart-livekit' | 'restart-ddclient' | 'scrub-filesystem' | 'configure-storage' | 'check-storage' | 'repair-storage',
      reason: string,
      options: { target?: string; identity?: string; filesystem?: string } = {},
    ) {
      const { data, error, response } = await client.POST('/v1/admin/actions/{action}', {
        params: { path: { action } }, body: { reason, ...options },
      });
      return requireResponseData(data, error, response.status);
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
