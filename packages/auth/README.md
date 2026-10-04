# Kaordo auth

Shared Keycloak OIDC browser integration. Call `initializeAuth(authConfigFromEnv(import.meta.env))` before `signIn`, `signUp`, `signOut`, or `authorizedFetch`. Tokens are kept in memory and refreshed before API requests. Do not persist them in local storage.

Interactive login and registration routes use `createAuthenticationUrl(config, action, redirectUri)` directly. Its short-lived client initializes without `check-sso` or third-party cookie probes; Keycloak's supported URL builders still own state, nonce and PKCE. The UI adds validated appearance parameters and replaces the entry route with the hosted form. Session discovery remains separate and uses the shared initialized client.

Initialization is shared within one app document; separate apps validate the same Keycloak SSO session. Auth status is reactive and failure-safe. `sessionFetch` in `api-client` owns the single refresh/retry policy for typed service requests; `account-ui` owns account bootstrap and the nonauthorizing preview. Keep auth initialization, credential redirects and HTTP status handling separate. Tests use injected identity dependencies without persisting tokens. See [verification](../../docs/refactoring.md).
