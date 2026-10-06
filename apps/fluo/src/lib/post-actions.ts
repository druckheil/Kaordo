// Coordinates Fluo post mutations and shared content cache invalidation

import type { QueryClient } from '@tanstack/svelte-query';
import type { FluoPost } from '@kaordo/contracts';
import { invalidateFluoPostQueries, type FluoApi } from '@kaordo/api-client';
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
    refresh: () => Promise<unknown> = () => invalidateFluoPostQueries(queryClient),
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
      );
    },
    follow(post: FluoPost): Promise<void> {
      return run(
        () => api.follow(post.author.id, !post.author.following),
        'Could not change your follow list.',
      );
    },
    save(post: FluoPost): Promise<void> {
      return run(
        () => api.setSaved(post.id, !post.saved),
        'Could not update your saved posts.',
      );
    },
    setVisibility(post: FluoPost, visibility: FluoPost['visibility']): Promise<void> {
      return run(
        () => api.setVisibility(post.id, visibility),
        'Could not change the post visibility.',
        () => invalidateFluoPostQueries(queryClient, { notifications: true }),
      );
    },
  };
}
