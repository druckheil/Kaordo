# Kaordo auth

Shared Keycloak OIDC browser integration. Call `initializeAuth(authConfigFromEnv(import.meta.env))` before `signIn`, `signUp`, `signOut`, or `authorizedFetch`. Tokens are kept in memory and refreshed before API requests. Do not persist them in local storage.
