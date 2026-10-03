# Kaordo account UI

Shared account gate and snapshot controller. `AccountGate` renders loading, sign-in and account errors; `session.ts` initializes OIDC and bootstraps the Kerno projection, discarding obsolete refresh results after cancellation/disposal. `session-preview.ts` validates a per-tab, one-hour preview containing only account ID, username and display name.

A preview may preserve familiar account chrome during SSO revalidation. It never authorizes API calls or opens protected app content. Tokens stay in `auth` memory; account requests/retry stay in `api-client`. No app duplicates the controller.

`pnpm test:account-preview` checks storage corruption, expiry, sign-out and snapshot races; the live journey checks transitions across independent apps. See [the refactor review](../../docs/refactoring.md).
