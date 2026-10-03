# Kaordo

Independent SvelteKit entry application with sign-in and registration routes. The credential and TOTP forms are hosted by Keycloak; the portal uses OIDC Authorization Code with PKCE through `@kaordo/auth`.

The combined static build is assembled by the repository root `build:pages` command. Public browser settings come from the repository root `.env` during the build.

## Code organization

The route composes `PortalWelcome`, `PortalApps` and `AuthScreen`; `portal-model` defines public app entries and heading derivations. Regado is deliberately absent from the app list. Authentication/account snapshot handling belongs to `auth` and `account-ui`, including the presentation-only preview during revalidation. No app copies the token/session controller.

Check with `pnpm check:front`, `pnpm test:auth`, public headless checks and the live identity journey. See [refactor evidence](../../docs/refactoring.md).
