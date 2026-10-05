// Provides typed Fluo and Nodo requests plus their feed pagination options

import type { FluoNewPost, FluoPage, FluoPost, NodoUpload, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

export type Feed = 'latest' | 'following' | 'mine' | 'saved';

export function createFluoApi(apiBaseUrl: string, nodoBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  const nodo = nodoBaseUrl.replace(/\/$/, '');
  const nodoClient = createClient<paths>({ baseUrl: nodo, fetch: sessionFetch });

  return {
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
    async create(input: FluoNewPost): Promise<FluoPost> {
      const { data, error, response } = await client.POST('/v1/fluo/posts', { body: input });
      return requireResponseData(data, error, response.status);
    },
    async setVisibility(id: string, visibility: FluoPost['visibility']): Promise<void> {
      const { error, response } = await client.PATCH('/v1/fluo/posts/{id}', {
        params: { path: { id } }, body: { visibility }
      });
      requireResponseOk(response, error);
    },
    async remove(id: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/fluo/posts/{id}', { params: { path: { id } } });
      requireResponseOk(response, error);
    },
    async setSaved(id: string, saved: boolean): Promise<void> {
      const result = saved
        ? await client.PUT('/v1/fluo/posts/{id}/saved', { params: { path: { id } } })
        : await client.DELETE('/v1/fluo/posts/{id}/saved', { params: { path: { id } } });
      requireResponseOk(result.response, result.error);
    },
    async react(id: string, value: 'good' | 'bad' | null): Promise<FluoPost> {
      const result = value
        ? await client.PUT('/v1/fluo/posts/{id}/reaction', { params: { path: { id } }, body: { value } })
        : await client.DELETE('/v1/fluo/posts/{id}/reaction', { params: { path: { id } } });
      return requireResponseData(result.data, result.error, result.response.status);
    },
    async follow(id: string, following: boolean): Promise<void> {
      const result = following
        ? await client.PUT('/v1/fluo/users/{id}/follow', { params: { path: { id } } })
        : await client.DELETE('/v1/fluo/users/{id}/follow', { params: { path: { id } } });
      requireResponseOk(result.response, result.error);
    },
    async uploadMetadata(id: string): Promise<NodoUpload | null> {
      const { data, error, response } = await nodoClient.GET('/v1/uploads/{id}/meta', {
        params: { path: { id } }
      });
      if (response.status === 202) return null;
      return requireResponseData(data, error, response.status);
    }
  };
}

export type FluoApi = ReturnType<typeof createFluoApi>;

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

export function commentsOptions(api: FluoApi, postId: string, enabled: boolean) {
  return {
    queryKey: ['fluo', 'comments', postId] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.comments(postId, pageParam, signal),
    getNextPageParam: (lastPage: FluoPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000,
    enabled
  };
}
