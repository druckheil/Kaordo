import type { RondoDetail, RondoNewServer, RondoServerPage, RondoChannel, RondoVoiceTicket, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { apiError, sessionFetch } from './http.ts';

export function createRondoApi(apiBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  return {
    async list(search = '', signal?: AbortSignal): Promise<RondoServerPage> {
      const { data, error, response } = await client.GET('/v1/rondo/servers', {
        params: { query: { q: search } }, signal
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async discover(search = '', signal?: AbortSignal): Promise<RondoServerPage> {
      const { data, error, response } = await client.GET('/v1/rondo/discover', {
        params: { query: { q: search } }, signal
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async create(input: RondoNewServer): Promise<RondoDetail> {
      const { data, error, response } = await client.POST('/v1/rondo/servers', { body: input });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async get(id: string): Promise<RondoDetail> {
      const { data, error, response } = await client.GET('/v1/rondo/servers/{id}', { params: { path: { id } } });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async join(id: string): Promise<RondoDetail> {
      const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/join', { params: { path: { id } } });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async invite(id: string, userId: string): Promise<RondoDetail> {
      const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/members', {
        params: { path: { id } }, body: { userId }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async leave(id: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/rondo/servers/{id}/membership', {
        params: { path: { id } }
      });
      if (!response.ok) throw apiError(error, response.status);
    },
    async createChannel(id: string, name: string): Promise<RondoChannel> {
      const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/channels', {
        params: { path: { id } }, body: { name }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async voiceToken(id: string): Promise<RondoVoiceTicket> {
      const { data, error, response } = await client.POST('/v1/rondo/channels/{id}/voice-token', {
        params: { path: { id } }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    }
  };
}

export type RondoApi = ReturnType<typeof createRondoApi>;

export function rondoServersOptions(api: RondoApi) {
  return {
    queryKey: ['rondo', 'servers'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.list('', signal),
    staleTime: 15_000,
    refetchInterval: 30_000
  };
}

export function rondoDiscoverOptions(api: RondoApi, search: string, enabled: boolean) {
  return {
    queryKey: ['rondo', 'discover', search] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.discover(search, signal),
    enabled,
    staleTime: 15_000
  };
}

export function rondoServerOptions(api: RondoApi, id: string | null) {
  return {
    queryKey: ['rondo', 'server', id] as const,
    queryFn: () => api.get(id!),
    enabled: !!id,
    staleTime: 15_000,
    refetchInterval: 30_000
  };
}
