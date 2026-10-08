# Kaordo account UI

Shared account gate and snapshot controller. `AccountGate` renders loading, sign-in and account errors; `session.ts` initializes OIDC and bootstraps the Kerno projection, discarding obsolete refresh results after cancellation/disposal. `session-preview.ts` validates a per-tab, one-hour preview containing only account ID, username and display name.

A preview may preserve familiar account chrome during SSO revalidation. It never authorizes API calls or opens protected app content. Tokens stay in `auth` memory; account requests/retry stay in `api-client`. No app duplicates the controller.

`UserAvatar` composes the shared Rhea/Bits UI Avatar, a loading fallback and a
corner availability dot. The authenticated gate scopes a presentation provider
and QueryClient to the app. Rendered avatars register account IDs with reference
counts; one compact snapshot refreshes every two seconds in the foreground,
in batches of at most 128 accounts. This also renews the signed-in account's
activity without refreshing feeds, conversations or message history. Hidden
tabs do not poll; focus/reconnection refreshes immediately. Kerno expires
activity after seven seconds, giving a nine-second expiry/poll budget under
healthy foreground connectivity. Failed/paused requests hide stale presence;
Nobody and Invisible return null and render no indicator. Previous snapshot
data preserves loaded images when registrations change. Signed media URLs use
the server's existing minute buckets, so presence polling does not change image
URLs on every request. Disposal aborts requests and clears the scoped cache.

`pnpm test:account-preview` checks storage corruption, expiry, sign-out and snapshot races; the live journey checks transitions across independent apps. See [the refactor review](../../docs/refactoring.md).
