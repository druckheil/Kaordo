// Coordinates cancellable Fluo post mutations and shared content cache invalidation

import type { QueryClient } from '@tanstack/svelte-query';
import type { FluoPost } from '@kaordo/contracts';
import { invalidateFluoPostQueries, type FluoApi } from '@kaordo/api-client';
import { errorMessage } from './fluo-model';

export function createFluoPostActions(
  api: Pick<FluoApi, 'react' | 'follow' | 'setSaved' | 'setVisibility'>,
  queryClient: QueryClient,
  onError: (message: string) => void,
) {
  const lifetime = new AbortController();

  async function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    fallbackMessage: string,
    refresh: () => Promise<unknown> = () => invalidateFluoPostQueries(queryClient),
  ): Promise<T | undefined> {
    if (lifetime.signal.aborted) return;
    try {
      onError('');
      const result = await action(lifetime.signal);
      if (lifetime.signal.aborted) return;
      await refresh();
      return lifetime.signal.aborted ? undefined : result;
    } catch (cause) {
      if (!lifetime.signal.aborted) onError(errorMessage(cause, fallbackMessage));
    }
  }

  return {
    dispose(): void {
      lifetime.abort();
    },
    react(post: FluoPost, value: FluoPost['myReaction']): Promise<FluoPost | undefined> {
      return run(
        (signal) => api.react(post.id, value, signal),
        'Could not save your reaction.',
      );
    },
    follow(post: FluoPost): Promise<void> {
      return run(
        (signal) => api.follow(post.author.id, !post.author.following, signal),
        'Could not change your follow list.',
      );
    },
    save(post: FluoPost): Promise<void> {
      return run(
        (signal) => api.setSaved(post.id, !post.saved, signal),
        'Could not update your saved posts.',
      );
    },
    setVisibility(post: FluoPost, visibility: FluoPost['visibility']): Promise<void> {
      return run(
        (signal) => api.setVisibility(post.id, visibility, signal),
        'Could not change the post visibility.',
        () => invalidateFluoPostQueries(queryClient, { notifications: true }),
      );
    },
  };
}

export type FluoPostActionHandlers = ReturnType<typeof createFluoPostActions>;
