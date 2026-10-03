// Coordinates post mutations and keeps feed cache updates consistent

import type { QueryClient, InfiniteData } from '@tanstack/svelte-query';
import type { FluoPage, FluoPost } from '@kaordo/contracts';
import type { FluoApi } from '@kaordo/api-client';
import { errorMessage } from './fluo-model';

type PostReaction = 'good' | 'bad' | null;

export function createFluoPostActions(
  api: FluoApi,
  queryClient: QueryClient,
  onError: (message: string) => void,
) {
  async function run(
    action: () => Promise<unknown>,
    fallbackMessage: string,
    refresh: () => Promise<unknown>,
  ): Promise<void> {
    try {
      onError('');
      await action();
      await refresh();
    } catch (cause) {
      onError(errorMessage(cause, fallbackMessage));
    }
  }

  return {
    react(post: FluoPost, value: PostReaction): Promise<void> {
      return run(
        () => api.react(post.id, value),
        'Could not save your reaction.',
        () => queryClient.invalidateQueries({ queryKey: ['fluo'] }),
      );
    },
    follow(post: FluoPost): Promise<void> {
      return run(
        () => api.follow(post.author.id, !post.author.following),
        'Could not change your follow list.',
        () => queryClient.invalidateQueries({ queryKey: ['fluo'] }),
      );
    },
    save(post: FluoPost): Promise<void> {
      return run(
        () => api.setSaved(post.id, !post.saved),
        'Could not update your saved posts.',
        async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['fluo', 'feed'] }),
            queryClient.invalidateQueries({ queryKey: ['fluo', 'post', post.id] }),
          ]);
        },
      );
    },
  };
}

export function removePostFromCachedFeeds(queryClient: QueryClient, postId: string): void {
  queryClient.setQueriesData<InfiniteData<FluoPage>>({ queryKey: ['fluo', 'feed'] }, (cached) => {
    if (!cached) return cached;
    return {
      ...cached,
      pages: cached.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.id !== postId),
      })),
    };
  });
}
