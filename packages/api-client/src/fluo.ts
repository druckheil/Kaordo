// Provides typed Fluo and Nodo requests plus their feed pagination options

import type {
  FluoNewPost, FluoPage, FluoPost, FluoPostThread, FluoNotificationPage,
  FluoNotificationSummary, FluoNotificationReadState, FluoSettings, FluoSettingsPatch, NodoUpload, paths
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

export type Feed = 'latest' | 'following' | 'mine' | 'saved';

export function createFluoApi(apiBaseUrl: string, nodoBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  const nodo = nodoBaseUrl.replace(/\/$/, '');
  const nodoClient = createClient<paths>({ baseUrl: nodo, fetch: sessionFetch });

  return {
    async settings(signal?: AbortSignal): Promise<FluoSettings> {
      const { data, error, response } = await client.GET('/v1/fluo/settings', { signal });
      return requireResponseData(data, error, response.status);
    },
    async updateSettings(patch: FluoSettingsPatch, signal?: AbortSignal): Promise<FluoSettings> {
      const { data, error, response } = await client.PATCH('/v1/fluo/settings', { body: patch, signal });
      return requireResponseData(data, error, response.status);
    },
    async notifications(cursor?: string, signal?: AbortSignal): Promise<FluoNotificationPage> {
      const { data, error, response } = await client.GET('/v1/fluo/notifications', {
        params: { query: { cursor, limit: 20 } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async notificationSummary(signal?: AbortSignal): Promise<FluoNotificationSummary> {
      const { data, error, response } = await client.GET('/v1/fluo/notifications/unread-count', { signal });
      return requireResponseData(data, error, response.status);
    },
    async readNotification(id: string, signal?: AbortSignal): Promise<FluoNotificationReadState> {
      const { data, error, response } = await client.PUT('/v1/fluo/notifications/{id}/read', {
        params: { path: { id } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async readNotifications(through: string, signal?: AbortSignal): Promise<FluoNotificationSummary> {
      const { data, error, response } = await client.PUT('/v1/fluo/notifications/read', { body: { through }, signal });
      return requireResponseData(data, error, response.status);
    },
    async list(feed: Feed, cursor?: string, signal?: AbortSignal, search?: string): Promise<FluoPage> {
      const { data, error, response } = await client.GET('/v1/fluo/posts', {
        params: { query: { feed, cursor, limit: 20, q: search } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async comments(id: string, cursor?: string, signal?: AbortSignal): Promise<FluoPage> {
      const { data, error, response } = await client.GET('/v1/fluo/posts/{id}/comments', {
        params: { path: { id }, query: { cursor } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async get(id: string, signal?: AbortSignal): Promise<FluoPost> {
      const { data, error, response } = await client.GET('/v1/fluo/posts/{id}', { params: { path: { id } }, signal });
      return requireResponseData(data, error, response.status);
    },
    async thread(id: string, signal?: AbortSignal): Promise<FluoPostThread> {
      const { data, error, response } = await client.GET('/v1/fluo/posts/{id}/thread', {
        params: { path: { id } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async create(input: FluoNewPost): Promise<FluoPost> {
      const { data, error, response } = await client.POST('/v1/fluo/posts', { body: input });
      return requireResponseData(data, error, response.status);
    },
    async setVisibility(id: string, visibility: FluoPost['visibility'], signal?: AbortSignal): Promise<void> {
      const { error, response } = await client.PATCH('/v1/fluo/posts/{id}', {
        params: { path: { id } }, body: { visibility }, signal
      });
      requireResponseOk(response, error);
    },
    async remove(id: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/fluo/posts/{id}', { params: { path: { id } } });
      requireResponseOk(response, error);
    },
    async setSaved(id: string, saved: boolean, signal?: AbortSignal): Promise<void> {
      const result = saved
        ? await client.PUT('/v1/fluo/posts/{id}/saved', { params: { path: { id } }, signal })
        : await client.DELETE('/v1/fluo/posts/{id}/saved', { params: { path: { id } }, signal });
      requireResponseOk(result.response, result.error);
    },
    async react(id: string, value: FluoPost['myReaction'], signal?: AbortSignal): Promise<FluoPost> {
      const result = value
        ? await client.PUT('/v1/fluo/posts/{id}/reaction', { params: { path: { id } }, body: { value }, signal })
        : await client.DELETE('/v1/fluo/posts/{id}/reaction', { params: { path: { id } }, signal });
      return requireResponseData(result.data, result.error, result.response.status);
    },
    async follow(id: string, following: boolean, signal?: AbortSignal): Promise<void> {
      const result = following
        ? await client.PUT('/v1/fluo/users/{id}/follow', { params: { path: { id } }, signal })
        : await client.DELETE('/v1/fluo/users/{id}/follow', { params: { path: { id } }, signal });
      requireResponseOk(result.response, result.error);
    },
    async uploadMetadata(id: string, signal?: AbortSignal): Promise<NodoUpload | null> {
      const { data, error, response } = await nodoClient.GET('/v1/uploads/{id}/meta', {
        params: { path: { id } }, signal
      });
      if (response.status === 202) return null;
      return requireResponseData(data, error, response.status);
    }
  };
}

export type FluoApi = ReturnType<typeof createFluoApi>;

export const fluoSettingsKey = ['fluo', 'settings'] as const;

export function fluoSettingsOptions(api: Pick<FluoApi, 'settings'>) {
  return {
    queryKey: fluoSettingsKey,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.settings(signal),
    staleTime: 30_000
  };
}

export function feedOptions(api: FluoApi, feed: Feed, search?: string) {
  return {
    queryKey: ['fluo', 'feed', feed, search ?? ''] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.list(feed, pageParam, signal, search),
    getNextPageParam: (lastPage: FluoPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true
  };
}

export function commentsOptions(api: FluoApi, postId: string) {
  return {
    queryKey: ['fluo', 'comments', postId] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.comments(postId, pageParam, signal),
    getNextPageParam: (lastPage: FluoPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000
  };
}
