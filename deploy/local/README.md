# Local account stack

Docker Compose is required for the two PostgreSQL instances and Keycloak. This profile is bound to localhost and uses Keycloak `start-dev`; it is not a public deployment configuration.

From the repository root, run `pnpm dev` with Docker running. Open `http://localhost:8765/register/` or `http://localhost:8765/login/`. The command creates ignored public and private local configuration when missing, starts the dependencies, runs Kerno, builds the static apps and serves every route at one origin. Press Ctrl+C to stop the site and Kerno; `pnpm dev:stop` stops the containers. `pnpm dev:web` runs the frontend alone if Docker is unavailable, but login cannot complete without Keycloak and PostgreSQL.

The manual setup below is only needed when customizing addresses or running services separately.

1. Copy `deploy/local/.env.example` to `deploy/local/.env`. Replace the three password placeholders with independent random hexadecimal values. Set `KAORDO_SITE_ORIGIN` to the origin used for the frontend (`http://localhost:8765` for the combined site, or `http://localhost:5173` for the portal Vite server).
2. Copy the repository root `.env.example` to `.env`. Its four `VITE_` values are public browser configuration shared by all apps. The auth URL must match the Keycloak issuer host.
3. Run `docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml up -d` from the repository root. Wait for Keycloak at `http://localhost:8080/realms/kaordo/.well-known/openid-configuration`, then run `pnpm auth:configure` to apply the Username and Password registration form and the Kerno token audience.
4. Run `./scripts/run-kerno-local.sh` from the repository root. It reads the ignored local credentials file without displaying the password, starts Kerno at `127.0.0.1:8081`, and checks that the users table exists. Use hexadecimal passwords, as in step 1, so the database URI needs no escaping.
5. Run `pnpm --filter @kaordo/portal dev` and open `/register/`, or run `pnpm build:pages` and serve `dist/pages` at the configured site origin for the combined apps.

Registration and password/TOTP entry take place on Keycloak's hosted forms. After TOTP setup, Keycloak returns an access token to the browser app. The app calls `POST /v1/session`, which creates the Kaordo UUIDv7 account record. Other modules check the same Keycloak SSO session and call the same endpoint; `GET /v1/me` returns the current record. Tokens stay in memory.

The realm JSON is imported only into an empty Keycloak database. The registration profile, Kerno audience mapper, and default `basic` and `profile` scopes are checked on every `pnpm dev` run, including existing realms. The `basic` scope supplies the required `sub` claim. The command checks the effective client mappers; once a user exists, it also evaluates an example access token and requires `aud=kerno-api`, `sub`, and `preferred_username`. Account setup errors show Kerno's safe failure reason after one forced token refresh; they never display a token or raw verifier error. Other realm changes still require an explicit configuration migration. The local setup has no email recovery, backup, external TLS, or public tunnel configuration.
