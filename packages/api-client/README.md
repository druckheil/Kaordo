# Kaordo API client

Typed OpenAPI clients for the Kerno Fluo, Ligo, Rondo, Lingvo and Regado endpoints.

`sessionFetch` attaches the current access token, refreshes it after a `401`, and retries the request once. Service clients share response-data and error handling. Query option helpers define each module's cache keys and pagination behavior.

`bootstrapIdentity` creates the initial account session and retries once after refreshing authentication. Apps should use the service clients instead of constructing Kerno requests themselves.

Fluo's notification requests share the generated route map and session retry policy. The latest notification page and access-filtered unread summary use four-second foreground polling plus focus/reconnection refresh. `fluo-notifications.ts` owns these query options, immutable read-cache updates and ordered page merging. Native infinite-query pagination reuses the current page and fetches older cursors independently, so history cannot delay new activity. `fluoNotificationItems` joins history at the current page's exact server-ordered boundary; a missing boundary triggers one history refresh. The app enables notification pages only in Notifications and uses the lighter summary elsewhere. Active history refreshes every five minutes to renew media links; each polling query refreshes immediately when enabled. Individual and bulk read operations use one scoped TanStack mutation; the API only allows marking read.

`admin-queries.ts` defines independent Regado keys for summary, metrics, system, users, audit, logs and cursor-paginated access cases. All read clients accept AbortSignal where used by queries. `message-cache.ts` shares immutable append/replace operations across Ligo/Rondo, preserving pagination parameters and idempotent sends. Application-owned QueryClients are cleared when their app unmounts.

`lingvo.ts` owns dictionary, card, catalogue, practice and activity queries plus
typed mutations. Dictionary keys keep invalidation scoped to the affected
collection. Reads and writes accept AbortSignal; card creation and review saves
retain caller-provided request IDs across retries.

`node --test scripts/api-client.test.mjs` checks refresh/retry, typed admin parameters, errors/204 responses, cancellation and cache updates. See [code ownership and verification](../../docs/refactoring.md).
