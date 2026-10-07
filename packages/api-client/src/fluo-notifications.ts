// Owns Fluo notification query options, ordered page merging and immutable read-cache updates

import type { FluoNotification, FluoNotificationPage, FluoNotificationReadState } from '@kaordo/contracts';
import type { FluoApi } from './fluo.ts';

export const fluoNotificationKeys = {
  all: ['fluo', 'notifications'] as const,
  list: ['fluo', 'notifications', 'list'] as const,
  recent: ['fluo', 'notifications', 'recent'] as const,
  summary: ['fluo', 'notifications', 'summary'] as const
};

const notificationPolling = {
  staleTime: 0,
  refetchInterval: 4_000,
  refetchOnWindowFocus: true
};

export function fluoNotificationSummaryOptions(api: FluoApi) {
  return {
    ...notificationPolling,
    queryKey: fluoNotificationKeys.summary,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.notificationSummary(signal)
  };
}

export function fluoNotificationRecentOptions(api: FluoApi) {
  return {
    ...notificationPolling,
    queryKey: fluoNotificationKeys.recent,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.notifications(undefined, signal)
  };
}

export function fluoNotificationsOptions(api: FluoApi, recent?: FluoNotificationPage) {
  return {
    queryKey: fluoNotificationKeys.list,
    initialPageParam: undefined as string | undefined,
    // The polling query already owns the current page; history only fetches older cursors.
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      pageParam === undefined && recent ? Promise.resolve(recent) : api.notifications(pageParam, signal),
    getNextPageParam: (lastPage: FluoNotificationPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true
  };
}

export function fluoNotificationItems(
  recent: FluoNotificationPage | undefined,
  pages: readonly FluoNotificationPage[] = []
): FluoNotification[] {
  if (recent && !recent.nextCursor) return recent.items;
  const history = pages.flatMap((page) => page.items);
  if (!recent) return history;

  // Join at the exact server-ordered boundary; current entries replace stale read/media state.
  const boundaryId = recent.items.at(-1)?.id;
  const boundary = history.findIndex((item) => item.id === boundaryId);
  return boundary < 0 ? recent.items : [...recent.items, ...history.slice(boundary + 1)];
}

export function readFluoNotificationPage(page: FluoNotificationPage, state: FluoNotificationReadState): FluoNotificationPage {
  return {
    ...page,
    unreadCount: state.unreadCount,
    items: page.items.map((item) => item.id === state.id ? { ...item, readAt: state.readAt } : item)
  };
}

export function readFluoNotificationHistory<T extends { pages: FluoNotificationPage[] }>(
  history: T | undefined, state: FluoNotificationReadState
): T | undefined {
  if (!history) return history;
  return { ...history, pages: history.pages.map((page) => readFluoNotificationPage(page, state)) };
}
