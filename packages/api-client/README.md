# Kaordo API client

Typed OpenAPI clients for the Kerno Fluo, Ligo, Rondo, Lingvo and Regado endpoints.

`sessionFetch` attaches the current access token, refreshes it after a `401`, and retries the request once. Service clients share response-data and error handling. Query option helpers define each module's cache keys and pagination behavior.

`session.ts` implements `bootstrapIdentity`, creating the initial account session and retrying once after refreshing authentication. The public entry point re-exports it. Apps use the service clients instead of constructing Kerno requests themselves. Consumer query helpers and state controllers can depend on only the operations they use. Shared chat synchronization/outbox behavior belongs to `chat-client`.

Fluo's notification requests share the generated route map and session retry policy. The latest notification page and access-filtered unread summary use four-second foreground polling plus focus/reconnection refresh. `fluo-notifications.ts` owns these query options, immutable read-cache updates and ordered page merging. Native infinite-query pagination reuses the current page and fetches older cursors independently, so history cannot delay new activity. `fluoNotificationItems` joins history at the current page's exact server-ordered boundary; a missing boundary triggers one history refresh. The app enables notification pages only in Notifications and uses the lighter summary elsewhere. Active history refreshes every five minutes to renew media links; each polling query refreshes immediately when enabled. Individual and bulk read operations use one scoped TanStack mutation; the API only allows marking read.

`fluo-profiles.ts` owns case-insensitive username query keys, profile refresh,
cursor-paginated follower/following queries and shared invalidation after follow
changes. Saved profiles cancel stale reads before replacing cache data and ignore
completion after the action owner has closed. Profile editing and availability requests use generated
contracts and accept lifetime AbortSignals. Author-filtered feeds keep their own
cache keys while retaining the existing post access and pagination policies;
their request/filter options are named instead of positional.

`user-presentation.ts` exchanges an active-session heartbeat for compact avatar
and privacy-filtered presence snapshots. It chunks requested IDs to the
contract's 128-account limit and reuses the shared session retry/cancellation
policy. Its native TanStack query options own foreground polling, image retention
and the request timeout; `account-ui` owns subscriptions and application lifetime.

`admin-queries.ts` defines independent Regado keys for summary, metrics, system, users, audit, logs and cursor-paginated access cases. All read clients accept AbortSignal where used by queries. Ligo member additions and individual/bulk Fluo notification reads also accept their controller's lifetime signal. Fluo query helpers accept only the API operations they use. `message-cache.ts` shares immutable append/replace operations across Ligo/Rondo, preserving pagination parameters and idempotent sends. Application-owned QueryClients are cleared when their app unmounts.

Each QueryClient has the library's `QueryClientProvider` lifecycle. Mounting and
unmounting the client connects and releases native focus/online subscriptions;
explicit clients passed to query factories alone do not establish that lifecycle.

`lingvo.ts` owns dictionary, card, catalogue, practice and activity queries plus
typed mutations. Dictionary keys keep invalidation scoped to the affected
collection. Reads and writes accept AbortSignal; card creation and review saves
retain caller-provided request IDs across retries.

`node --test scripts/api-client.test.mjs` checks refresh/retry, typed admin parameters, errors/204 responses, cancellation and cache updates. See [code ownership and verification](../../docs/refactoring.md).
