// Exposes typed service clients, query policies and authenticated account bootstrap

export { appendSentMessage, replaceCachedMessage } from './message-cache.ts';
export {
	adminSummaryOptions,
	adminSystemOptions,
	adminMetricsOptions,
	adminUsersOptions,
	adminAuditOptions,
	adminLogsOptions,
	adminHostOptions,
	adminHostAlertsOptions,
	adminHostUsageOptions,
	adminDataUsageOptions,
	adminHostOperationsOptions,
	adminHostOperationOptions
} from './admin-queries.ts';

export {
	createFluoApi,
	feedOptions,
	commentsOptions,
	fluoSettingsKey,
	fluoSettingsOptions,
	type Feed,
	type FluoApi,
	type FluoFeedFilter
} from './fluo.ts';
export { invalidateFluoPostQueries, removePostFromCachedFeeds } from './fluo-cache.ts';
export {
	fluoProfileKeys,
	fluoProfileOptions,
	fluoConnectionsOptions,
	invalidateFluoFollowQueries,
	updateFluoProfileCache
} from './fluo-profiles.ts';
export {
	fluoNotificationKeys,
	fluoNotificationSummaryOptions,
	fluoNotificationRecentOptions,
	fluoNotificationsOptions,
	fluoNotificationItems,
	readFluoNotificationPage,
	readFluoNotificationHistory
} from './fluo-notifications.ts';
export {
	createLigoApi,
	ligoConversationOptions,
	ligoConversationDetailOptions,
	ligoUserSearchOptions,
	ligoMessageOptions,
	type LigoApi
} from './ligo.ts';
export {
	createRondoApi,
	rondoServersOptions,
	rondoDiscoverOptions,
	rondoServerOptions,
	type RondoApi
} from './rondo.ts';
export {
	createLingvoApi,
	lingvoDictionariesOptions,
	lingvoOverviewOptions,
	lingvoCardsOptions,
	lingvoStudyOptions,
	lingvoCatalogOptions,
	type LingvoApi,
	type LingvoCardFilter
} from './lingvo.ts';
export { createAdminApi, type AdminApi } from './admin.ts';

export { bootstrapIdentity } from './session.ts';
export { createEncryptionApi, type EncryptionApi } from './encryption.ts';
export {
	createMemoroApi,
	memoroKeys,
	memoroMonthOptions,
	memoroDayOptions,
	type MemoroApi
} from './memoro.ts';
export { createUserPresentationApi, userPresentationOptions } from './user-presentation.ts';
