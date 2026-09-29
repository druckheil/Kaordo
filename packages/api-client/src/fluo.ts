import { authorizedFetch, refreshAccessToken } from '@kaordo/auth';
import type { FluoNewPost, FluoPage, FluoPost, NodoUpload, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';

export type Feed = 'latest' | 'following' | 'mine' | 'saved';

function message(error: unknown, status: number): Error {
  const detail = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string'
    ? error.error : `Request failed (${status}).`;
  return new Error(detail);
}

export function createFluoApi(apiBaseUrl: string, nodoBaseUrl: string) {
  const sessionFetch = async (request: Request) => {
    let response = await authorizedFetch(request.clone());
    if (response.status === 401) {
      await refreshAccessToken();
      response = await authorizedFetch(request.clone());
    }
    return response;
  };
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  const nodo = nodoBaseUrl.replace(/\/$/, '');
  const nodoClient = createClient<paths>({ baseUrl: nodo, fetch: sessionFetch });

  return {
    async list(feed: Feed, cursor?: string, signal?: AbortSignal, search?: string): Promise<FluoPage> {
      const { data, error, response } = await client.GET('/v1/fluo/posts', {
        params: { query: { feed, cursor, limit: 20, q: search } }, signal
      });
      if (!data) throw message(error, response.status);
      return data;
    },
    async comments(id: string, cursor?: string, signal?: AbortSignal): Promise<FluoPage> {
      const { data, error, response } = await client.GET('/v1/fluo/posts/{id}/comments', {
        params: { path: { id }, query: { cursor } }, signal
      });
      if (!data) throw message(error, response.status);
      return data;
    },
    async get(id: string): Promise<FluoPost> {
      const { data, error, response } = await client.GET('/v1/fluo/posts/{id}', { params: { path: { id } } });
      if (!data) throw message(error, response.status);
      return data;
    },
    async create(input: FluoNewPost): Promise<FluoPost> {
      const { data, error, response } = await client.POST('/v1/fluo/posts', { body: input });
      if (!data) throw message(error, response.status);
      return data;
    },
    async remove(id: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/fluo/posts/{id}', { params: { path: { id } } });
      if (!response.ok) throw message(error, response.status);
    },
    async setSaved(id: string, saved: boolean): Promise<void> {
      const result = saved
        ? await client.PUT('/v1/fluo/posts/{id}/saved', { params: { path: { id } } })
        : await client.DELETE('/v1/fluo/posts/{id}/saved', { params: { path: { id } } });
      if (!result.response.ok) throw message(result.error, result.response.status);
    },
    async react(id: string, value: 'good' | 'bad' | null): Promise<FluoPost> {
      const result = value
        ? await client.PUT('/v1/fluo/posts/{id}/reaction', { params: { path: { id } }, body: { value } })
        : await client.DELETE('/v1/fluo/posts/{id}/reaction', { params: { path: { id } } });
      if (!result.data) throw message(result.error, result.response.status);
      return result.data;
    },
    async follow(id: string, following: boolean): Promise<void> {
      const result = following
        ? await client.PUT('/v1/fluo/users/{id}/follow', { params: { path: { id } } })
        : await client.DELETE('/v1/fluo/users/{id}/follow', { params: { path: { id } } });
      if (!result.response.ok) throw message(result.error, result.response.status);
    },
    async uploadMetadata(id: string): Promise<NodoUpload | null> {
      const { data, error, response } = await nodoClient.GET('/v1/uploads/{id}/meta', {
        params: { path: { id } }
      });
      if (response.status === 202) return null;
      if (!data) throw message(error, response.status);
      return data;
    }
  };
}

export type FluoApi = ReturnType<typeof createFluoApi>;

export function feedOptions(api: FluoApi, feed: Feed, search?: string) {
  return {
    queryKey: ['fluo', 'feed', feed, search ?? ''] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) => api.list(feed, pageParam, signal, search),
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
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) => api.comments(postId, pageParam, signal),
    getNextPageParam: (lastPage: FluoPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000,
    enabled
  };
}
