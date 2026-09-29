# Kerno

Go identity and Fluo metadata API. chi serves the shared account routes and `/v1/fluo/*`; pgx stores users, posts, comments, quotes, reactions, follows, and media references in PostgreSQL. go-oidc validates Keycloak access tokens against discovery and JWKS. A post's media is accepted only after Nodo confirms upload ownership and processing. Kerno signs short-lived media links when returning an accessible post.

Required environment: `DATABASE_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, comma-separated `KAORDO_ALLOWED_ORIGINS`, `NODO_INTERNAL_URL`, `NODO_PUBLIC_URL`, and a 32-byte hex `NODO_MEDIA_SIGNING_KEY`. `LISTEN_ADDR` defaults to `127.0.0.1:8081`. PostgreSQL migrations `001_users.sql` and `002_fluo.sql` must be applied. See `deploy/local/README.md` for local startup.
