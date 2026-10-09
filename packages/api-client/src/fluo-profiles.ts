// Shares profile queries, cursor follow lists and cross-view follow invalidation

import type { QueryClient } from '@tanstack/query-core';
import type { FluoConnectionPage, FluoProfile } from '@kaordo/contracts';
import type { FluoApi } from './fluo.ts';
import { invalidateFluoPostQueries } from './fluo-cache.ts';

export const fluoProfileKeys = {
	all: ['fluo', 'profile'] as const,
	profile: (username: string) => ['fluo', 'profile', username.toLowerCase()] as const,
	connections: ['fluo', 'connections'] as const
};

export function fluoProfileOptions(api: Pick<FluoApi, 'profile'>, username: string) {
	return {
		queryKey: fluoProfileKeys.profile(username),
		queryFn: ({ signal }: { signal: AbortSignal }) => api.profile(username, signal),
		staleTime: 15_000,
		refetchInterval: 30_000
	};
}

export function fluoConnectionsOptions(
	api: Pick<FluoApi, 'connections'>,
	id: string,
	kind: 'followers' | 'following'
) {
	return {
		queryKey: [...fluoProfileKeys.connections, id, kind] as const,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
			api.connections(id, kind, pageParam, signal),
		getNextPageParam: (page: FluoConnectionPage) => page.nextCursor ?? undefined,
		staleTime: 15_000
	};
}

export async function updateFluoProfileCache(
	queryClient: QueryClient,
	profile: FluoProfile,
	signal: AbortSignal
): Promise<void> {
	if (signal.aborted) return;
	const key = fluoProfileKeys.profile(profile.username);
	await queryClient.cancelQueries({ queryKey: key });
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The signal can abort while awaiting query cancellation
	if (!signal.aborted) queryClient.setQueryData(key, profile);
}

export async function invalidateFluoFollowQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		invalidateFluoPostQueries(queryClient),
		queryClient.invalidateQueries({ queryKey: fluoProfileKeys.all }),
		queryClient.invalidateQueries({ queryKey: fluoProfileKeys.connections })
	]);
}
