// Batches rendered account avatars and refreshes privacy-filtered availability

import { onDestroy } from 'svelte';
import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import { createUserPresentationApi, userPresentationOptions } from '@kaordo/api-client';

export const userPresentationContext = Symbol('user-presentation');

export function createUserPresentationState(apiBaseUrl: string, userId: string, queryClient: QueryClient) {
  const api = createUserPresentationApi(apiBaseUrl);
  const lifetime = new AbortController();
  const subscribers = new Map<string, number>();
  let userIds = $state([userId]);
  let pending: ReturnType<typeof setTimeout> | undefined;
  const query = createQuery(() => userPresentationOptions(api, userId, userIds, lifetime.signal), () => queryClient);
  const presentations = $derived(new Map(query.data?.map((item) => [item.id, item])));

  function updateSubscription() {
    if (lifetime.signal.aborted || pending !== undefined) return;
    pending = setTimeout(() => {
      pending = undefined;
      const next = [...new Set([userId, ...subscribers.keys()])].sort();
      if (next.length !== userIds.length || next.some((id, index) => id !== userIds[index])) userIds = next;
    }, 50);
  }

  onDestroy(() => {
    lifetime.abort();
    clearTimeout(pending);
    subscribers.clear();
    void queryClient.cancelQueries();
    queryClient.clear();
  });

  return {
    register(id: string) {
      subscribers.set(id, (subscribers.get(id) ?? 0) + 1);
      updateSubscription();
      return () => {
        const count = subscribers.get(id) ?? 0;
        if (count > 1) subscribers.set(id, count - 1);
        else subscribers.delete(id);
        updateSubscription();
      };
    },
    get(id: string) {
      const item = presentations.get(id);
      if (!item) return undefined;
      return query.isError || query.fetchStatus === 'paused' ? { ...item, presence: null } : item;
    }
  };
}

export type UserPresentationState = ReturnType<typeof createUserPresentationState>;
