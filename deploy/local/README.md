# Local Kaordo stack

Docker Compose is required for the two PostgreSQL instances, Keycloak and LiveKit. Kerno and Nodo run as local Go processes. This profile is bound to localhost and uses Keycloak `start-dev`; it is not a public deployment configuration.

Nodo accepts an uploaded file for a new post or message for 23 hours and garbage-collects unreferenced bytes after 24 hours. This gap lets Kerno finish its bounded media claim before cleanup can start. Once the final Fluo or Ligo reference is deleted, the upload ID is retired; upload the bytes again to reuse them later.

From the repository root, run `pnpm dev` with Docker running. Open `http://localhost:8765/register/` or `http://localhost:8765/login/`, then `/fluo/`, `/ligo/`, `/rondo/`, `/lingvo/` or `/memoro/`. The command creates ignored public and private local configuration when missing, starts the dependencies, applies the application migrations, runs Kerno and Nodo, then starts seven Vite development servers behind a same-origin proxy. Vite HMR updates frontend edits without restarting the stack; new modules and Go changes require a restart. Press Ctrl+C to stop the frontend servers and both Go services; `pnpm dev:stop` stops them and the containers together. Install `ffmpeg` and `ffprobe` for video processing. `pnpm dev:web` remains a static frontend-only preview if Docker is unavailable; login and product actions need the full stack.

Run only one `pnpm dev` instance at a time. A second launch exits immediately if Kerno (`127.0.0.1:8081`), Nodo (`127.0.0.1:8082`), Portal (`127.0.0.1:8765`) or any product Vite server (`127.0.0.1:18766`–`18771`) already owns its port. LiveKit remains in Docker between site restarts. Stop the existing `pnpm dev` terminal with Ctrl+C or run `pnpm dev:stop` from another terminal before restarting. The stop command only signals the Kaordo process registered by this checkout; it does not kill unrelated port owners.

The manual setup below is only needed when customizing addresses or running services separately.

1. Copy `deploy/local/.env.example` to `deploy/local/.env`. Replace the three password placeholders and both LiveKit credential placeholders with independent random hexadecimal values. Set `KAORDO_SITE_ORIGIN` to the origin used for the frontend (`http://localhost:8765` for the combined site, or `http://localhost:5173` for the portal Vite server).
2. Copy the repository root `.env.example` to `.env`. Its five `VITE_` values are public browser configuration shared by all apps. The auth URL must match the Keycloak issuer host.
3. Run `docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml up -d` from the repository root. Wait for Keycloak at `http://localhost:8080/realms/kaordo/.well-known/openid-configuration`, then run `pnpm auth:configure` to apply the Username and Password registration form and the Kerno token audience.
4. Apply application migrations to the app database in order:

   ```sh
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/002_fluo.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/003_reusable_fluo_media.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/004_fluo_saved_posts.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/005_fluo_media_retirement.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/006_fluo_search.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/007_ligo.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/008_ligo_self.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/009_ligo_message_actions.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/010_rondo.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/011_regado.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/012_fluo_quote_tombstones.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/013_fluo_saved_post_counts.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/014_fluo_notifications.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/015_fluo_settings.sql
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec -T app-db psql -X -v ON_ERROR_STOP=1 -U kaordo -d kaordo -f /migrations/016_lingvo.sql
   ```

   Start `./scripts/run-kerno-local.sh` and `./scripts/run-nodo-local.sh` in separate terminals. Both read the ignored signing key; Kerno also reads the LiveKit API credentials. Kerno listens on `127.0.0.1:8081`, Nodo on `127.0.0.1:8082`.
5. Run `pnpm --filter @kaordo/portal dev` and open `/register/`, or run `pnpm build:pages` and serve `dist/pages` at the configured site origin for the combined apps.

Registration and password/TOTP entry take place on Keycloak's hosted forms. After TOTP setup, Keycloak shows one-time recovery codes and asks the user to save them before completing registration. A saved code can replace the authenticator code during login. Keycloak then returns an access token to the browser app. The app calls `POST /v1/session`, which creates the Kaordo UUIDv7 account record. Other modules check the same Keycloak SSO session using a hidden iframe where browser policy permits, then call the same endpoint; `GET /v1/me` returns the current record. During that check, a per-tab `sessionStorage` cache can keep the previously verified account ID, username and display name visible. That preview expires after one hour and never authorizes requests or protected content; the module gate opens only after Kerno verifies the current session. If Kerno fails, the preview is replaced by the account-service error. Access and refresh tokens stay in memory.

The realm JSON is imported only into an empty Keycloak database. The registration profile, Kerno audience mapper, default `basic` and `profile` scopes, session/password/TOTP policy, recovery action, and browser second-factor flow are checked on every `pnpm dev` run, including existing realms. Sessions allow 30 days of inactivity and a five-year maximum, with five-minute access tokens and single-use rotating refresh tokens. The native password form defaults **Stay signed in** on; the user can turn it off on a shared device. The web client inherits realm lifetimes after stale client overrides are removed. The `basic` scope supplies the required `sub` claim. The command checks effective client mappers; once a user exists, it also evaluates an example access token and requires `aud=kerno-api`, `sub`, and `preferred_username`. Account setup errors show Kerno's safe failure reason after one forced token refresh; they never display a token or raw verifier error. The local setup has no email/password recovery, external TLS, or public tunnel configuration.

LiveKit in this Compose profile uses `127.0.0.1:7880` for signaling, TCP `7881` and UDP `7882` for local WebRTC media. Voice works only for browsers that can reach those local ports. Cloudflare Tunnel alone does not expose LiveKit's required UDP media path; public voice needs a separate reachable media/TURN endpoint and TLS configuration. Self-hosted LiveKit does not revoke previously issued participant tokens on removal, so Kerno uses short-lived join tokens and stops issuing new ones after membership is removed. The updated Rondo client requires LiveKit's E2EE support and distributes room keys in private, device-signed envelopes. Older deployed clients do not gain this protection until updated; see [encryption boundaries](../../docs/encryption.md).

With `pnpm dev` running, `pnpm test:auth:live` runs a headless Chromium journey through registration, TOTP, recovery-code and TOTP login, Kerno account creation, the application gates, Fluo media/posts/interactions and Ligo messaging/scroll behavior. It also checks that a cached account preview stays visible during session revalidation and sign-out clears it. It creates and removes a temporary identity and account row. Set `CHROME_BIN` to use a custom Chrome installation; otherwise Playwright's installed Chromium is used when macOS Chrome is unavailable. Run `pnpm test:auth` for fast tests without services.

## Encrypted local backups

Install the open-source `restic` CLI. Choose a backup repository on a separate disk or remote destination. Store its password in a private file outside the repository and keep a second copy of that password somewhere safe. Set `RESTIC_REPOSITORY` and `RESTIC_PASSWORD_FILE` in the shell; the password file must have mode `0600`. Run `restic init` once for a new repository.

For a one-machine setup, a removable physical SSD is a practical first destination. On macOS, confirm it appears in `diskutil list external physical`; a disk image stored on the internal drive does not protect against that drive failing. Replace `BackupDrive` with its mounted volume name, then run:

```sh
mkdir -p "$HOME/.config/kaordo"
if [ ! -e "$HOME/.config/kaordo/restic-password" ]; then
  (umask 077; set -C; openssl rand -hex 32 > "$HOME/.config/kaordo/restic-password")
fi
export RESTIC_PASSWORD_FILE="$HOME/.config/kaordo/restic-password"
export RESTIC_REPOSITORY="/Volumes/BackupDrive/kaordo-restic"
restic init # only for a new repository
pnpm backup:local
pnpm backup:verify
```

Never overwrite the password file for an existing repository. Save its password in a password manager that remains accessible if this computer fails. Keep the removable drive disconnected between backup runs. The paths are examples, not an active backup configuration; use an actual separate disk or a remote restic repository before relying on them.

With both database containers running, `pnpm backup:local` streams a custom-format `pg_dump` of the app and Keycloak databases into encrypted restic snapshots, then backs up `deploy/local/media` under the same run ID. `pnpm backup:verify` performs `restic check --read-data`, restores the latest complete set into temporary databases and a temporary media directory, verifies the app table, Kaordo realm and account references, then removes the temporary copies. Neither command writes plaintext database dumps to disk or replaces active databases. `pnpm test:backup:live` runs this workflow against an isolated temporary repository and key.

The two database dumps and media snapshot are taken at different instants. Stop registration, posting and uploads during a backup that must be a coordinated recovery point. Backups are only independent when the restic repository, a recoverable copy of its password, and the local administrator credentials survive loss of the primary server. The commands do not schedule backups or replace an external restore drill.

## Refactor verification

`pnpm test:product:db` creates a disposable migrated database and runs Fluo, Ligo, Rondo and Regado tests with the Go race detector; `test:fluo:db`, `test:ligo:db` and `test:rondo:db` are aliases for this complete suite. It never recreates the active application database. `pnpm test:product:ui` and `pnpm test:regado:ui` run temporary Vite servers with fixture identity/API responses and require no running product services. Public UI tests use the built static artifact.

The live journey also checks Rondo messages/calls/camera and Fluo reload/Escape/reopen, search and media. Local Regado system/metrics data can be unavailable because Compose does not start the Linux agent or Prometheus. This is different from the NixOS profile. See [current evidence and code map](../../docs/refactoring.md).
