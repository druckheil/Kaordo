// Updates Fluo content caches without refetching unrelated account settings

import type { InfiniteData, QueryClient } from '@tanstack/query-core';
import type { FluoPage } from '@kaordo/contracts';

export function invalidateFluoPostQueries(
  queryClient: QueryClient, { notifications = false }: { notifications?: boolean } = {}
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: ['fluo'],
    predicate: ({ queryKey }) => queryKey[1] === 'feed' || queryKey[1] === 'comments'
      || queryKey[1] === 'thread' || (notifications && queryKey[1] === 'notifications')
  });
}

export function removePostFromCachedFeeds(queryClient: QueryClient, postId: string): void {
  queryClient.setQueriesData<InfiniteData<FluoPage>>({ queryKey: ['fluo', 'feed'] }, (cached) => {
    if (!cached) return cached;
    return {
      ...cached,
      pages: cached.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.id !== postId)
      }))
    };
  });
}
