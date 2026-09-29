# Local account stack

Docker Compose is required for the two PostgreSQL instances and Keycloak. This profile is bound to localhost and uses Keycloak `start-dev`; it is not a public deployment configuration.

From the repository root, run `pnpm dev` with Docker running. Open `http://localhost:8765/register/` or `http://localhost:8765/login/`. The command creates ignored public and private local configuration when missing, starts the dependencies, runs Kerno, builds the static apps and serves every route at one origin. Press Ctrl+C to stop the site and Kerno; `pnpm dev:stop` stops the containers. `pnpm dev:web` runs the frontend alone if Docker is unavailable, but login cannot complete without Keycloak and PostgreSQL.

Run only one `pnpm dev` instance at a time. A second launch now exits immediately if Kerno (`127.0.0.1:8081`) or the site (`127.0.0.1:8765`) already owns its port. Stop the existing `pnpm dev` terminal with Ctrl+C before restarting. `pnpm dev:stop` stops Docker containers, not a running site or Kerno process.

The manual setup below is only needed when customizing addresses or running services separately.

1. Copy `deploy/local/.env.example` to `deploy/local/.env`. Replace the three password placeholders with independent random hexadecimal values. Set `KAORDO_SITE_ORIGIN` to the origin used for the frontend (`http://localhost:8765` for the combined site, or `http://localhost:5173` for the portal Vite server).
2. Copy the repository root `.env.example` to `.env`. Its four `VITE_` values are public browser configuration shared by all apps. The auth URL must match the Keycloak issuer host.
3. Run `docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml up -d` from the repository root. Wait for Keycloak at `http://localhost:8080/realms/kaordo/.well-known/openid-configuration`, then run `pnpm auth:configure` to apply the Username and Password registration form and the Kerno token audience.
4. Run `./scripts/run-kerno-local.sh` from the repository root. It reads the ignored local credentials file without displaying the password, starts Kerno at `127.0.0.1:8081`, and checks that the users table exists. Use hexadecimal passwords, as in step 1, so the database URI needs no escaping.
5. Run `pnpm --filter @kaordo/portal dev` and open `/register/`, or run `pnpm build:pages` and serve `dist/pages` at the configured site origin for the combined apps.

Registration and password/TOTP entry take place on Keycloak's hosted forms. After TOTP setup, Keycloak shows one-time recovery codes and asks the user to save them before completing registration. A saved code can replace the authenticator code during login. Keycloak then returns an access token to the browser app. The app calls `POST /v1/session`, which creates the Kaordo UUIDv7 account record. Other modules check the same Keycloak SSO session using a hidden iframe where browser policy permits, then call the same endpoint; `GET /v1/me` returns the current record. During that check, a per-tab `sessionStorage` cache can keep the previously verified account ID, username and display name visible. That preview expires after one hour and never authorizes requests or protected content; the module gate opens only after Kerno verifies the current session. If Kerno fails, the preview is replaced by the account-service error. Access and refresh tokens stay in memory.

The realm JSON is imported only into an empty Keycloak database. The registration profile, Kerno audience mapper, default `basic` and `profile` scopes, password/TOTP policy, recovery action, and browser second-factor flow are checked on every `pnpm dev` run, including existing realms. The `basic` scope supplies the required `sub` claim. The command checks effective client mappers; once a user exists, it also evaluates an example access token and requires `aud=kerno-api`, `sub`, and `preferred_username`. Account setup errors show Kerno's safe failure reason after one forced token refresh; they never display a token or raw verifier error. The local setup has no email/password recovery, external TLS, or public tunnel configuration.

With `pnpm dev` running, `pnpm test:auth:live` runs a headless Chrome journey through registration, TOTP, recovery-code and TOTP login, Kerno account creation, and all four application gates. It also holds Kerno's session response to check that a cached preview stays visible during navigation, a Kerno failure does not leave account-gated content visible, and sign-out clears the preview. It creates and removes a temporary identity and account row. Set `CHROME_BIN` if Chrome is not at the default macOS path. Run `pnpm test:auth` for the fast tests without services.

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

With both database containers running, `pnpm backup:local` streams a custom-format `pg_dump` of the app and Keycloak databases directly into separate encrypted restic snapshots under one run ID. `pnpm backup:verify` performs `restic check --read-data`, restores the latest complete pair into temporary databases, verifies the app table and Kaordo realm, checks that restored Kaordo accounts refer to restored Keycloak subjects, then drops the temporary databases. Neither command writes plaintext dumps to disk or replaces active databases. `pnpm test:backup:live` runs this workflow against an isolated temporary repository and key.

The two database dumps are individually consistent but are taken at different instants. Stop registration and account changes during a backup that must be a coordinated recovery point. Backups are only independent when the restic repository, a recoverable copy of its password, and the local administrator credentials survive loss of the primary server. The commands do not schedule backups or replace an external restore drill.
