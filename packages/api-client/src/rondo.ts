// Provides typed Rondo server and voice requests with server query options

import type { RondoDetail, RondoNewServer, RondoServerPage, RondoChannel, RondoVoiceTicket, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

export function createRondoApi(apiBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  return {
    async list(search = '', signal?: AbortSignal): Promise<RondoServerPage> {
      const { data, error, response } = await client.GET('/v1/rondo/servers', {
        params: { query: { q: search } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async discover(search = '', signal?: AbortSignal): Promise<RondoServerPage> {
      const { data, error, response } = await client.GET('/v1/rondo/discover', {
        params: { query: { q: search } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async create(input: RondoNewServer): Promise<RondoDetail> {
      const { data, error, response } = await client.POST('/v1/rondo/servers', { body: input });
      return requireResponseData(data, error, response.status);
    },
    async get(id: string, signal?: AbortSignal): Promise<RondoDetail> {
      const { data, error, response } = await client.GET('/v1/rondo/servers/{id}', { params: { path: { id } }, signal });
      return requireResponseData(data, error, response.status);
    },
    async join(id: string): Promise<RondoDetail> {
      const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/join', { params: { path: { id } } });
      return requireResponseData(data, error, response.status);
    },
    async invite(id: string, userId: string): Promise<RondoDetail> {
      const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/members', {
        params: { path: { id } }, body: { userId }
      });
      return requireResponseData(data, error, response.status);
    },
    async leave(id: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/rondo/servers/{id}/membership', {
        params: { path: { id } }
      });
      requireResponseOk(response, error);
    },
    async createChannel(id: string, name: string): Promise<RondoChannel> {
      const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/channels', {
        params: { path: { id } }, body: { name }
      });
      return requireResponseData(data, error, response.status);
    },
    async voiceToken(id: string): Promise<RondoVoiceTicket> {
      const { data, error, response } = await client.POST('/v1/rondo/channels/{id}/voice-token', {
        params: { path: { id } }
      });
      return requireResponseData(data, error, response.status);
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
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!id) throw new Error('A server must be selected.');
      return api.get(id, signal);
    },
    enabled: !!id,
    staleTime: 15_000,
    refetchInterval: 30_000
  };
}
