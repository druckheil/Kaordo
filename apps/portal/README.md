# Kaordo

Independent SvelteKit entry application with sign-in and registration routes. The credential and TOTP forms are hosted by Keycloak; the portal uses OIDC Authorization Code with PKCE through `@kaordo/auth`.

The combined static build is assembled by the repository root `build:pages` command. Public browser settings come from the repository root `.env` during the build.
