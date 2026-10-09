// Coordinates opaque diary requests and encrypted TanStack Query cache entries
import type { MemoroDayUpdate, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, sessionFetch } from './http.ts';

export function createMemoroApi(baseUrl: string, nodoBaseUrl: string) {
	const client = createClient<paths>({ baseUrl, fetch: sessionFetch });
	const nodo = createClient<paths>({ baseUrl: nodoBaseUrl, fetch: sessionFetch });
	return {
		async month(tag: string, signal?: AbortSignal) {
			const { data, error, response } = await client.GET('/v1/memoro/month', {
				params: { query: { tag } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async day(dayTag: string, signal?: AbortSignal) {
			const { data, error, response } = await client.GET('/v1/memoro/days/{dayTag}', {
				params: { path: { dayTag } },
				signal
			});
			return requireResponseData(data, error, response.status).day;
		},
		async saveDay(dayTag: string, body: MemoroDayUpdate, signal?: AbortSignal) {
			const { data, error, response } = await client.PUT('/v1/memoro/days/{dayTag}', {
				params: { path: { dayTag } },
				body,
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async uploadMetadata(id: string, signal?: AbortSignal) {
			const { data, error, response } = await nodo.GET('/v1/uploads/{id}/meta', {
				params: { path: { id } },
				signal
			});
			return requireResponseData(data, error, response.status);
		}
	};
}
export type MemoroApi = ReturnType<typeof createMemoroApi>;
export const memoroKeys = {
	month: (tag: string) => ['memoro', 'month', tag] as const,
	day: (tag: string) => ['memoro', 'day', tag] as const
};
export function memoroMonthOptions(api: MemoroApi, tag: string) {
	return {
		queryKey: memoroKeys.month(tag),
		queryFn: ({ signal }: { signal: AbortSignal }) => api.month(tag, signal),
		staleTime: 15_000,
		retry: false
	};
}
export function memoroDayOptions(api: MemoroApi, tag: string) {
	return {
		queryKey: memoroKeys.day(tag),
		queryFn: ({ signal }: { signal: AbortSignal }) => api.day(tag, signal),
		staleTime: 15_000,
		retry: false
	};
}
