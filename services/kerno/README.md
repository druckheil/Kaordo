# Kerno

Go identity API. chi serves `POST /v1/session`, `GET /v1/me`, and `GET /healthz`; pgx stores the Kaordo user projection in PostgreSQL; go-oidc validates Keycloak access tokens against its discovery endpoint and JWKS.

Required environment: `DATABASE_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, and comma-separated `KAORDO_ALLOWED_ORIGINS`. `LISTEN_ADDR` defaults to `127.0.0.1:8081`. See `deploy/local/README.md` for local startup.
