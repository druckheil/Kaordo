// Exposes the service clients and creates the initial authenticated account session

import { authorizedFetch, refreshAccessToken } from '@kaordo/auth';
import type { UserIdentity, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { apiErrorDetail } from './http.ts';

export { appendSentMessage, replaceCachedMessage } from './message-cache.ts';
export { adminSummaryOptions, adminSystemOptions, adminMetricsOptions, adminUsersOptions,
  adminAuditOptions, adminLogsOptions, adminCaseContentOptions } from './admin-queries.ts';

export {
  createFluoApi, feedOptions, commentsOptions, fluoSettingsKey, fluoSettingsOptions, type Feed, type FluoApi
} from './fluo.ts';
export { invalidateFluoPostQueries, removePostFromCachedFeeds } from './fluo-cache.ts';
export {
  fluoNotificationKeys,
  fluoNotificationSummaryOptions, fluoNotificationRecentOptions, fluoNotificationsOptions,
  fluoNotificationItems, readFluoNotificationPage, readFluoNotificationHistory
} from './fluo-notifications.ts';
export { createLigoApi, ligoConversationOptions, ligoConversationDetailOptions, ligoUserSearchOptions, ligoMessageOptions, type LigoApi } from './ligo.ts';
export { createRondoApi, rondoServersOptions, rondoDiscoverOptions, rondoServerOptions, type RondoApi } from './rondo.ts';
export {
  createLingvoApi, lingvoDictionariesOptions, lingvoOverviewOptions, lingvoCardsOptions,
  lingvoStudyOptions, lingvoCatalogOptions, type LingvoApi, type LingvoCardFilter
} from './lingvo.ts';
export { createAdminApi, type AdminApi } from './admin.ts';

export async function bootstrapIdentity(
  apiBaseUrl: string,
  auth: { fetch: typeof authorizedFetch; refresh: typeof refreshAccessToken } =
    { fetch: authorizedFetch, refresh: refreshAccessToken }
): Promise<UserIdentity> {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: auth.fetch });
  const requestSession = () => client.POST('/v1/session', { headers: { Accept: 'application/json' } });
  let result = await requestSession();

  if (result.response.status === 401) {
    await auth.refresh();
    result = await requestSession();
  }

  return requireIdentity(result.data, result.error, result.response.status);
}

function requireIdentity(data: UserIdentity | undefined, error: unknown, status: number): UserIdentity {
  if (data) return data;

  const detail = apiErrorDetail(error);
  const message = `Account setup failed (${status}).${detail ? ` ${detail}` : ''}`;
  throw new Error(message);
}
