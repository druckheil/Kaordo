// Coordinates active notification queries, cursor history and serialized read mutations

import { onDestroy } from 'svelte';
import { createInfiniteQuery, createMutation, createQuery, type InfiniteData, type QueryClient } from '@tanstack/svelte-query';
import type { FluoNotificationPage, FluoNotificationReadState, FluoNotificationSummary } from '@kaordo/contracts';
import {
  fluoNotificationKeys, fluoNotificationRecentOptions, fluoNotificationSummaryOptions,
  fluoNotificationsOptions, readFluoNotificationHistory, readFluoNotificationPage, type FluoApi
} from '@kaordo/api-client';
import { errorMessage } from './fluo-model';

type ReadAction = { id: string } | { through: string };

export function createFluoNotificationState(
  api: Pick<FluoApi, 'notifications' | 'notificationSummary' | 'readNotification' | 'readNotifications'>,
  queryClient: QueryClient, active: () => boolean, onError: (message: string) => void
) {
  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());
  const enabled = $derived(typeof window !== 'undefined' && active());
  const recent = createQuery(() => ({
    ...fluoNotificationRecentOptions(api), enabled
  }), () => queryClient);
  const history = createInfiniteQuery(() => ({
    ...fluoNotificationsOptions(api, recent.data), enabled: enabled && !!recent.data
  }), () => queryClient);
  const summary = createQuery(() => ({
    ...fluoNotificationSummaryOptions(api), enabled: typeof window !== 'undefined' && !enabled
  }), () => queryClient);
  const unreadCount = $derived(recent.dataUpdatedAt >= summary.dataUpdatedAt
    ? recent.data?.unreadCount ?? summary.data?.unreadCount ?? 0
    : summary.data?.unreadCount ?? 0);

  $effect(() => {
    const obsoleteKeys = enabled
      ? [fluoNotificationKeys.summary]
      : [fluoNotificationKeys.recent, fluoNotificationKeys.list];
    for (const queryKey of obsoleteKeys) void queryClient.cancelQueries({ queryKey });
  });

  let refreshedBoundary: string | null = null;
  $effect(() => {
    const current = recent.data;
    const cached = history.data;
    const boundary = current?.items.at(-1)?.id;
    if (!enabled || !current?.nextCursor || !cached || !boundary || history.isFetching) return;
    if (cached.pages.some((page) => page.items.some((item) => item.id === boundary))) return;
    if (refreshedBoundary === boundary) return;
    refreshedBoundary = boundary;
    // Rebuild native pagination once when a burst or deletion removes its join boundary.
    void queryClient.invalidateQueries({ queryKey: fluoNotificationKeys.list });
  });

  const read = createMutation(() => ({
    scope: { id: 'fluo-notification-read' },
    mutationFn: async (action: ReadAction): Promise<FluoNotificationReadState | FluoNotificationSummary> =>
      'id' in action ? api.readNotification(action.id, lifetime.signal) : api.readNotifications(action.through, lifetime.signal),
    onMutate: () => {
      onError('');
      return queryClient.cancelQueries({ queryKey: fluoNotificationKeys.all });
    },
    onSuccess: async (state) => {
      await queryClient.cancelQueries({ queryKey: fluoNotificationKeys.all });
      if (lifetime.signal.aborted) return;
      if ('id' in state) {
        queryClient.setQueryData<FluoNotificationPage>(fluoNotificationKeys.recent,
          (page) => page && readFluoNotificationPage(page, state));
        queryClient.setQueryData<InfiniteData<FluoNotificationPage>>(fluoNotificationKeys.list,
          (pages) => readFluoNotificationHistory(pages, state));
      }
      queryClient.setQueryData(fluoNotificationKeys.summary, { unreadCount: state.unreadCount });
      const queryKey = 'id' in state ? fluoNotificationKeys.recent : fluoNotificationKeys.all;
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (cause, action) => {
      if (lifetime.signal.aborted) return;
      const message = 'id' in action ? 'Could not mark the notification as read.' : 'Could not mark notifications as read.';
      onError(errorMessage(cause, message));
    }
  }), () => queryClient);

  return { recent, history, read, get unreadCount() { return unreadCount; } };
}

export type FluoNotificationState = ReturnType<typeof createFluoNotificationState>;
