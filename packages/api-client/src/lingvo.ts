// Provides authenticated Lingvo requests and cancellable dictionary query options
import type { paths } from '@kaordo/contracts';
import { createPrivateLingvoClient } from '@kaordo/lingvo-client/private-dictionary';
import { encryptionSession } from '@kaordo/crypto';
import { createPrivateRecords } from './private-records.ts';
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
	async function catalog(nativeLanguage: 'en' | 'ru', signal?: AbortSignal) {
		const { data, error, response } = await client.GET('/v1/lingvo/catalog', {
			params: { query: { nativeLanguage } },
			signal
		});
		return requireResponseData(data, error, response.status);
	}
	return createPrivateLingvoClient(
		createPrivateRecords(apiBaseUrl, 'lingvo'),
		catalog,
		encryptionSession().signal
	);
}

export type LingvoApi = ReturnType<typeof createLingvoApi>;

export function lingvoDictionariesOptions(api: LingvoApi) {
	return {
		queryKey: ['lingvo', 'dictionaries'] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.dictionaries(signal),
		staleTime: 30_000
	};
}

export function lingvoOverviewOptions(api: LingvoApi, dictionaryId: string) {
	return {
		queryKey: ['lingvo', dictionaryId, 'overview'] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.overview(dictionaryId, signal),
		enabled: !!dictionaryId,
		staleTime: 10_000,
		refetchInterval: 30_000
	};
}

export function lingvoCardsOptions(api: LingvoApi, dictionaryId: string, filter: LingvoCardFilter) {
	return {
		queryKey: ['lingvo', dictionaryId, 'cards', filter] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.cards(dictionaryId, filter, signal),
		enabled: !!dictionaryId,
		staleTime: 10_000
	};
}

export function lingvoStudyOptions(
	api: Pick<LingvoApi, 'study'>,
	dictionaryId: string,
	kind: 'word' | 'phrase',
	folder?: string
) {
	return {
		queryKey: ['lingvo', dictionaryId, 'study', kind, folder] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.study(dictionaryId, kind, folder, signal),
		enabled: !!dictionaryId,
		staleTime: 0,
		refetchInterval: 15_000
	};
}

export function lingvoCatalogOptions(api: LingvoApi, nativeLanguage: 'en' | 'ru') {
	return {
		queryKey: ['lingvo', 'catalog', nativeLanguage] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.catalog(nativeLanguage, signal),
		staleTime: Infinity
	};
}
