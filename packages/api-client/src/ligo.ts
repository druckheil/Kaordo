// Provides typed Ligo chat requests, live updates, and query pagination options

import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source';
import type {
  LigoConversation, LigoConversationPage, LigoMessage, LigoMessagePage,
  LigoNewConversation, LigoNewMessage, LigoUserPage, NodoUpload, paths
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

class FatalStreamError extends Error {}

export function createLigoApi(apiBaseUrl: string, nodoBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  const nodo = createClient<paths>({ baseUrl: nodoBaseUrl.replace(/\/$/, ''), fetch: sessionFetch });

  return {
    async searchUsers(search: string, signal?: AbortSignal): Promise<LigoUserPage> {
      const { data, error, response } = await client.GET('/v1/ligo/users', {
        params: { query: { q: search } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async listConversations(cursor?: string, signal?: AbortSignal): Promise<LigoConversationPage> {
      const { data, error, response } = await client.GET('/v1/ligo/conversations', {
        params: { query: { cursor, limit: 30 } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async getConversation(id: string, signal?: AbortSignal): Promise<LigoConversation> {
      const { data, error, response } = await client.GET('/v1/ligo/conversations/{id}', {
        params: { path: { id } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async createConversation(input: LigoNewConversation): Promise<LigoConversation> {
      const { data, error, response } = await client.POST('/v1/ligo/conversations', { body: input });
      return requireResponseData(data, error, response.status);
    },
    async addMembers(id: string, participantIds: string[]): Promise<LigoConversation> {
      const { data, error, response } = await client.POST('/v1/ligo/conversations/{id}/members', {
        params: { path: { id } }, body: { participantIds }
      });
      return requireResponseData(data, error, response.status);
    },
    async listMessages(id: string, before?: string, signal?: AbortSignal): Promise<LigoMessagePage> {
      const { data, error, response } = await client.GET('/v1/ligo/conversations/{id}/messages', {
        params: { path: { id }, query: { before, limit: 30 } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async send(id: string, input: LigoNewMessage): Promise<LigoMessage> {
      const { data, error, response } = await client.POST('/v1/ligo/conversations/{id}/messages', {
        params: { path: { id } }, body: input
      });
      return requireResponseData(data, error, response.status);
    },
    async editMessage(id: string, messageId: string, text: string): Promise<LigoMessage> {
      const { data, error, response } = await client.PATCH('/v1/ligo/conversations/{id}/messages/{messageId}', {
        params: { path: { id, messageId } }, body: { text }
      });
      return requireResponseData(data, error, response.status);
    },
    async deleteMessage(id: string, messageId: string): Promise<void> {
      const { error, response } = await client.DELETE('/v1/ligo/conversations/{id}/messages/{messageId}', {
        params: { path: { id, messageId } }
      });
      requireResponseOk(response, error);
    },
    async setReaction(id: string, messageId: string, emoji: '❤️' | '👍' | '👎', active: boolean): Promise<LigoMessage> {
      const { data, error, response } = await client.PUT('/v1/ligo/conversations/{id}/messages/{messageId}/reaction', {
        params: { path: { id, messageId } }, body: { emoji, active }
      });
      return requireResponseData(data, error, response.status);
    },
    async markDelivered(id: string, messageId: string): Promise<void> {
      const { error, response } = await client.PUT('/v1/ligo/conversations/{id}/delivered', {
        params: { path: { id } }, body: { messageId }
      });
      requireResponseOk(response, error);
    },
    async markRead(id: string, messageId: string): Promise<void> {
      const { error, response } = await client.PUT('/v1/ligo/conversations/{id}/read', {
        params: { path: { id } }, body: { messageId }
      });
      requireResponseOk(response, error);
    },
    async uploadMetadata(id: string): Promise<NodoUpload | null> {
      const { data, error, response } = await nodo.GET('/v1/uploads/{id}/meta', {
        params: { path: { id } }
      });
      if (response.status === 202) return null;
      return requireResponseData(data, error, response.status);
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
          assertEventStreamResponse(response);
          onConnection?.(true);
          onHint(null); // catch writes between the initial list and subscription
        },
        onmessage(event) {
          handleStreamEvent(event.event, event.data, onHint);
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

function assertEventStreamResponse(response: Response): void {
  const isEventStream = response.headers.get('content-type')?.startsWith(EventStreamContentType);
  if (response.ok && isEventStream) return;

  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new FatalStreamError(`Live updates rejected (${response.status}).`);
  }
  throw new Error('Live updates disconnected.');
}

function handleStreamEvent(event: string, payload: string, onHint: (conversationId: string | null) => void): void {
  if (event === 'resync') {
    onHint(null);
    return;
  }
  if (event !== 'update') return;

  const data: unknown = JSON.parse(payload);
  if (isConversationHint(data)) onHint(data.conversationId);
}

function isConversationHint(value: unknown): value is { conversationId: string } {
  return typeof value === 'object' && value !== null &&
    'conversationId' in value && typeof value.conversationId === 'string';
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
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!id) throw new Error('A conversation must be selected.');
      return api.getConversation(id, signal);
    },
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
