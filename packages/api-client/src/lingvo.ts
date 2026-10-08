// Provides authenticated Lingvo requests and cancellable dictionary query options
import type {
  LingvoCard, LingvoNewCard, LingvoCardUpdate, LingvoDictionary, LingvoNewDictionary,
  LingvoSettings, LingvoReview, LingvoReviewResult, LingvoImport, LingvoImportResult, LingvoFolder, paths
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

export interface LingvoCardFilter {
  kind?: 'word' | 'phrase';
  status?: 'active' | 'known' | 'suspended';
  folder?: string;
  q?: string;
  offset?: number;
  limit?: number;
}

export function createLingvoApi(apiBaseUrl: string) {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
  return {
    async dictionaries(signal?: AbortSignal) {
      const { data, error, response } = await client.GET('/v1/lingvo/dictionaries', { signal });
      return requireResponseData(data, error, response.status);
    },
    async createDictionary(input: LingvoNewDictionary, signal?: AbortSignal): Promise<LingvoDictionary> {
      const { data, error, response } = await client.POST('/v1/lingvo/dictionaries', { body: input, signal });
      return requireResponseData(data, error, response.status);
    },
    async overview(dictionaryId: string, signal?: AbortSignal) {
      const { data, error, response } = await client.GET('/v1/lingvo/dictionaries/{dictionaryId}', {
        params: { path: { dictionaryId } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async settings(dictionaryId: string, input: LingvoSettings, signal?: AbortSignal): Promise<LingvoDictionary> {
      const { data, error, response } = await client.PUT('/v1/lingvo/dictionaries/{dictionaryId}/settings', {
        params: { path: { dictionaryId } }, body: input, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async cards(dictionaryId: string, filter: LingvoCardFilter, signal?: AbortSignal) {
      const { data, error, response } = await client.GET('/v1/lingvo/dictionaries/{dictionaryId}/cards', {
        params: { path: { dictionaryId }, query: filter }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async study(dictionaryId: string, kind: 'word' | 'phrase', folder?: string, signal?: AbortSignal) {
      const { data, error, response } = await client.GET('/v1/lingvo/dictionaries/{dictionaryId}/study', {
        params: { path: { dictionaryId }, query: { kind, folder } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async createCard(dictionaryId: string, input: LingvoNewCard, signal?: AbortSignal): Promise<LingvoCard> {
      const { data, error, response } = await client.POST('/v1/lingvo/dictionaries/{dictionaryId}/cards', {
        params: { path: { dictionaryId } }, body: input, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async updateCard(dictionaryId: string, cardId: string, input: LingvoCardUpdate, signal?: AbortSignal): Promise<LingvoCard> {
      const { data, error, response } = await client.PUT('/v1/lingvo/dictionaries/{dictionaryId}/cards/{cardId}', {
        params: { path: { dictionaryId, cardId } }, body: input, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async deleteCard(dictionaryId: string, cardId: string, revision: number, signal?: AbortSignal): Promise<void> {
      const { error, response } = await client.DELETE('/v1/lingvo/dictionaries/{dictionaryId}/cards/{cardId}', {
        params: { path: { dictionaryId, cardId }, query: { revision } }, signal
      });
      requireResponseOk(response, error);
    },
    async review(dictionaryId: string, cardId: string, input: LingvoReview, signal?: AbortSignal): Promise<LingvoReviewResult> {
      const { data, error, response } = await client.POST('/v1/lingvo/dictionaries/{dictionaryId}/cards/{cardId}/reviews', {
        params: { path: { dictionaryId, cardId } }, body: input, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async undo(dictionaryId: string, reviewId: string, signal?: AbortSignal): Promise<LingvoCard> {
      const { data, error, response } = await client.POST('/v1/lingvo/dictionaries/{dictionaryId}/reviews/{reviewId}/undo', {
        params: { path: { dictionaryId, reviewId } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async createFolder(dictionaryId: string, name: string, signal?: AbortSignal): Promise<LingvoFolder> {
      const { data, error, response } = await client.POST('/v1/lingvo/dictionaries/{dictionaryId}/folders', {
        params: { path: { dictionaryId } }, body: { name }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async deleteFolder(dictionaryId: string, folderId: string, signal?: AbortSignal): Promise<void> {
      const { error, response } = await client.DELETE('/v1/lingvo/dictionaries/{dictionaryId}/folders/{folderId}', {
        params: { path: { dictionaryId, folderId } }, signal
      });
      requireResponseOk(response, error);
    },
    async catalog(nativeLanguage: 'en' | 'ru', signal?: AbortSignal) {
      const { data, error, response } = await client.GET('/v1/lingvo/catalog', {
        params: { query: { nativeLanguage } }, signal
      });
      return requireResponseData(data, error, response.status);
    },
    async importCards(dictionaryId: string, input: LingvoImport, signal?: AbortSignal): Promise<LingvoImportResult> {
      const { data, error, response } = await client.POST('/v1/lingvo/dictionaries/{dictionaryId}/imports', {
        params: { path: { dictionaryId } }, body: input, signal
      });
      return requireResponseData(data, error, response.status);
    }
  };
}

export type LingvoApi = ReturnType<typeof createLingvoApi>;

export function lingvoDictionariesOptions(api: LingvoApi) {
  return { queryKey: ['lingvo', 'dictionaries'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.dictionaries(signal), staleTime: 30_000 };
}

export function lingvoOverviewOptions(api: LingvoApi, dictionaryId: string) {
  return { queryKey: ['lingvo', dictionaryId, 'overview'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.overview(dictionaryId, signal),
    enabled: !!dictionaryId, staleTime: 10_000, refetchInterval: 30_000 };
}

export function lingvoCardsOptions(api: LingvoApi, dictionaryId: string, filter: LingvoCardFilter) {
  return { queryKey: ['lingvo', dictionaryId, 'cards', filter] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.cards(dictionaryId, filter, signal),
    enabled: !!dictionaryId, staleTime: 10_000 };
}

export function lingvoStudyOptions(api: Pick<LingvoApi, 'study'>, dictionaryId: string, kind: 'word' | 'phrase', folder?: string) {
  return { queryKey: ['lingvo', dictionaryId, 'study', kind, folder] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.study(dictionaryId, kind, folder, signal),
    enabled: !!dictionaryId, staleTime: 0, refetchInterval: 15_000 };
}

export function lingvoCatalogOptions(api: LingvoApi, nativeLanguage: 'en' | 'ru') {
  return { queryKey: ['lingvo', 'catalog', nativeLanguage] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.catalog(nativeLanguage, signal), staleTime: Infinity };
}
