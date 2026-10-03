# Kaordo API client

Typed OpenAPI clients for the Kerno Fluo, Ligo, Rondo, and Regado endpoints.

`sessionFetch` attaches the current access token, refreshes it after a `401`, and retries the request once. Service clients share response-data and error handling. Query option helpers define each module's cache keys and pagination behavior.

`bootstrapIdentity` creates the initial account session and retries once after refreshing authentication. Apps should use the service clients instead of constructing Kerno requests themselves.

`admin-queries.ts` defines independent Regado keys for summary, metrics, system, users, audit, logs and cursor-paginated access cases. All read clients accept AbortSignal where used by queries. `message-cache.ts` shares immutable append/replace operations across Ligo/Rondo, preserving pagination parameters and idempotent sends. Application-owned QueryClients are cleared when their app unmounts.

`node --test scripts/api-client.test.mjs` checks refresh/retry, typed admin parameters, errors/204 responses, cancellation and cache updates. See [code ownership and verification](../../docs/refactoring.md).
