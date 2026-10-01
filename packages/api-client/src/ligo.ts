import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source';
import type {
  LigoConversation, LigoConversationPage, LigoMessage, LigoMessagePage,
  LigoNewConversation, LigoNewMessage, LigoUserPage, NodoUpload, paths
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { apiError, sessionFetch } from './http.ts';

class FatalStreamError extends Error {}

export function createLigoApi(apiBaseUrl: string, nodoBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  const nodo = createClient<paths>({ baseUrl: nodoBaseUrl.replace(/\/$/, ''), fetch: sessionFetch });

  return {
    async searchUsers(search: string, signal?: AbortSignal): Promise<LigoUserPage> {
      const { data, error, response } = await client.GET('/v1/ligo/users', {
        params: { query: { q: search } }, signal
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async listConversations(cursor?: string, signal?: AbortSignal): Promise<LigoConversationPage> {
      const { data, error, response } = await client.GET('/v1/ligo/conversations', {
        params: { query: { cursor, limit: 30 } }, signal
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async getConversation(id: string): Promise<LigoConversation> {
      const { data, error, response } = await client.GET('/v1/ligo/conversations/{id}', {
        params: { path: { id } }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async createConversation(input: LigoNewConversation): Promise<LigoConversation> {
      const { data, error, response } = await client.POST('/v1/ligo/conversations', { body: input });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async addMembers(id: string, participantIds: string[]): Promise<LigoConversation> {
      const { data, error, response } = await client.POST('/v1/ligo/conversations/{id}/members', {
        params: { path: { id } }, body: { participantIds }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async listMessages(id: string, before?: string, signal?: AbortSignal): Promise<LigoMessagePage> {
      const { data, error, response } = await client.GET('/v1/ligo/conversations/{id}/messages', {
        params: { path: { id }, query: { before, limit: 30 } }, signal
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async send(id: string, input: LigoNewMessage): Promise<LigoMessage> {
      const { data, error, response } = await client.POST('/v1/ligo/conversations/{id}/messages', {
        params: { path: { id } }, body: input
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async editMessage(id: string, messageId: string, text: string): Promise<LigoMessage> {
      const { data, error, response } = await client.PATCH('/v1/ligo/conversations/{id}/messages/{messageId}', {
        params: { path: { id, messageId } }, body: { text }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async deleteMessage(id: string, messageId: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/ligo/conversations/{id}/messages/{messageId}', {
        params: { path: { id, messageId } }
      });
      if (!response.ok) throw apiError(error, response.status);
    },
    async setReaction(id: string, messageId: string, emoji: '❤️' | '👍' | '👎', active: boolean): Promise<LigoMessage> {
      const { data, error, response } = await client.PUT('/v1/ligo/conversations/{id}/messages/{messageId}/reaction', {
        params: { path: { id, messageId } }, body: { emoji, active }
      });
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async markDelivered(id: string, messageId: string): Promise<void> {
      const { error, response } = await client.PUT('/v1/ligo/conversations/{id}/delivered', {
        params: { path: { id } }, body: { messageId }
      });
      if (!response.ok) throw apiError(error, response.status);
    },
    async markRead(id: string, messageId: string): Promise<void> {
      const { error, response } = await client.PUT('/v1/ligo/conversations/{id}/read', {
        params: { path: { id } }, body: { messageId }
      });
      if (!response.ok) throw apiError(error, response.status);
    },
    async uploadMetadata(id: string): Promise<NodoUpload | null> {
      const { data, error, response } = await nodo.GET('/v1/uploads/{id}/meta', {
        params: { path: { id } }
      });
      if (response.status === 202) return null;
      if (!data) throw apiError(error, response.status);
      return data;
    },
    async subscribe(
      signal: AbortSignal,
      onHint: (conversationId: string | null) => void,
      onConnection?: (connected: boolean) => void
    ): Promise<void> {
      await fetchEventSource(`${apiBaseUrl.replace(/\/$/, '')}/v1/ligo/events`, {
        signal,
        fetch: sessionFetch,
        openWhenHidden: false,
        async onopen(response) {
          if (!response.ok || !response.headers.get('content-type')?.startsWith(EventStreamContentType)) {
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
              throw new FatalStreamError(`Live updates rejected (${response.status}).`);
            }
            throw new Error('Live updates disconnected.');
          }
          onConnection?.(true);
          onHint(null); // catch writes between the initial list and subscription
        },
        onmessage(event) {
          if (event.event === 'resync') onHint(null);
          if (event.event === 'update') {
            const data: unknown = JSON.parse(event.data);
            if (data && typeof data === 'object' && 'conversationId' in data && typeof data.conversationId === 'string') {
              onHint(data.conversationId);
            }
          }
        },
        onclose() {
          onConnection?.(false);
          throw new Error('Reconnect the live stream with a fresh token.');
        },
        onerror(error) {
          onConnection?.(false);
          if (error instanceof FatalStreamError) throw error;
          return 1500;
        }
      });
    }
  };
}

export type LigoApi = ReturnType<typeof createLigoApi>;

export function ligoConversationOptions(api: LigoApi) {
  return {
    queryKey: ['ligo', 'conversations'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.listConversations(pageParam, signal),
    getNextPageParam: (last: LigoConversationPage) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  };
}

export function ligoUserSearchOptions(api: LigoApi, search: string, enabled: boolean) {
  return {
    queryKey: ['ligo', 'user-search', search] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.searchUsers(search, signal),
    enabled: enabled && search.length >= 2,
    staleTime: 30_000
  };
}

export function ligoConversationDetailOptions(api: LigoApi, id: string | null) {
  return {
    queryKey: ['ligo', 'conversation', id] as const,
    queryFn: () => api.getConversation(id!),
    enabled: !!id,
    staleTime: 15_000
  };
}

export function ligoMessageOptions(api: LigoApi, id: string) {
  return {
    queryKey: ['ligo', 'messages', id] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.listMessages(id, pageParam, signal),
    getNextPageParam: (last: LigoMessagePage) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    // Nodo links expire after nine minutes, even when no new message arrives.
    refetchInterval: 6 * 60_000,
    refetchOnWindowFocus: true
  };
}
