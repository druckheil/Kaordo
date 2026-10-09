// Exchanges active-session heartbeats for compact avatars and privacy-filtered presence

import createClient from 'openapi-fetch';
import { keepPreviousData } from '@tanstack/query-core';
import type { paths, UserPresentation } from '@kaordo/contracts';
import { requireResponseData, sessionFetch } from './http.ts';

export function createUserPresentationApi(baseUrl: string) {
	const client = createClient<paths>({ baseUrl: baseUrl.replace(/\/$/, ''), fetch: sessionFetch });
	return {
		async refresh(userIds: string[], signal: AbortSignal): Promise<UserPresentation[]> {
			const batches: string[][] = [];
			for (let index = 0; index < userIds.length; index += 128)
				batches.push(userIds.slice(index, index + 128));
			const pages = await Promise.all(
				batches.map(async (ids) => {
					const { data, error, response } = await client.POST('/v1/fluo/presence', {
						body: { userIds: ids },
						signal
					});
					return requireResponseData(data, error, response.status).items;
				})
			);
			return pages.flat();
		}
	};
}

export function userPresentationOptions(
	api: ReturnType<typeof createUserPresentationApi>,
	viewerId: string,
	userIds: string[],
	signal: AbortSignal
) {
	return {
		queryKey: ['account', 'presentation', viewerId, userIds] as const,
		queryFn: ({ signal: querySignal }: { signal: AbortSignal }) =>
			api.refresh(userIds, AbortSignal.any([querySignal, signal, AbortSignal.timeout(4000)])),
		enabled: typeof window !== 'undefined',
		refetchInterval: 2000,
		refetchOnWindowFocus: 'always' as const,
		placeholderData: keepPreviousData,
		retry: false,
		staleTime: 1000,
		gcTime: 0
	};
}
