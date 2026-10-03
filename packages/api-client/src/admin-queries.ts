// Defines independent, cancellable Regado cache entries and access-case pagination

import type { AdminContentPage } from '@kaordo/contracts';
import type { AdminApi } from './admin.ts';

const readPolicy = { staleTime: 15_000, retry: false } as const;
type ReadContext = { signal: AbortSignal };

export function adminSummaryOptions(api: AdminApi) {
  return { ...readPolicy, queryKey: ['regado', 'summary'] as const, queryFn: ({ signal }: ReadContext) => api.summary(signal) };
}

export function adminSystemOptions(api: AdminApi) {
  return { ...readPolicy, queryKey: ['regado', 'system'] as const, queryFn: ({ signal }: ReadContext) => api.system(signal) };
}

export function adminMetricsOptions(api: AdminApi, window: '1h' | '24h' | '7d') {
  return { ...readPolicy, queryKey: ['regado', 'metrics', window] as const, queryFn: ({ signal }: ReadContext) => api.metrics(window, signal) };
}

export function adminUsersOptions(api: AdminApi, search: string) {
  return { ...readPolicy, queryKey: ['regado', 'users', search] as const, queryFn: ({ signal }: ReadContext) => api.users(search, signal) };
}

export function adminAuditOptions(api: AdminApi) {
  return { ...readPolicy, queryKey: ['regado', 'audit'] as const, queryFn: ({ signal }: ReadContext) => api.audit(signal) };
}

export function adminLogsOptions(api: AdminApi, service: string) {
  return { ...readPolicy, queryKey: ['regado', 'logs', service] as const, queryFn: ({ signal }: ReadContext) => api.logs(service, signal) };
}

export function adminCaseContentOptions(api: AdminApi, id: string | null, kind: 'posts' | 'messages') {
  return {
    queryKey: ['regado', 'case', id, kind] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: ReadContext & { pageParam: string | undefined }) => {
      if (!id) throw new Error('An access case must be selected.');
      return api.caseContent(id, kind, pageParam, signal);
    },
    getNextPageParam: (page: AdminContentPage) => page.nextCursor ?? undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  };
}
