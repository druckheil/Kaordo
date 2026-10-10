# Production (NixOS)

`kaordo.nix` is imported by `/etc/nixos/configuration.nix`. It runs PostgreSQL, Keycloak, LiveKit, Kerno, Nodo, Caddy (HTTPS for `kaordo.link`), ddclient (Namecheap DDNS, every minute), Prometheus, Node Exporter and regado-agent as systemd services. Prometheus and Node Exporter listen on loopback only, and Kerno is the only way to reach them. `storage.nix` mounts the NixOS root, Nix store, logs and application data from `Data1`, a Btrfs pool with two copies (RAID1) across both disks. Databases, media, static releases (`/srv/kaordo/www/current`), metrics and secrets live under `/srv/kaordo`. GRUB is installed on both disks. [Regado](../../docs/regado.md) manages the pool's devices.

## Network

Router port shares to the host:

| Port | Protocol | Purpose                                        |
| ---- | -------- | ---------------------------------------------- |
| 443  | TCP      | HTTPS: apps, Keycloak, APIs, LiveKit signaling |
| 7881 | TCP      | LiveKit RTC fallback                           |
| 7882 | UDP      | LiveKit RTC media                              |
| 3478 | UDP      | LiveKit TURN                                   |

Never forward PostgreSQL, 7880 or 8080–8082. Caddy issues certificates over TCP 443. The Keycloak Admin API is not published; reach it through an SSH port forward.

## Deploy

Merging into protected `main` authorizes an automatic production deployment after a complete successful push CI run ([CI](../../docs/ci.md)). Scope branches and pull requests run tests only. The server pulls public Git source and checks evidence through outbound HTTPS; CD opens no additional port and places no SSH key, server secret, user data or device key in GitHub Actions.

`cd.nix` runs a one-minute poller and an isolated `kaordo-build` user. The controller verifies the current main SHA, repository/workflow identity and every validation layer, then builds a clean revision without access to production data. It rechecks the SHA and CI before switching. Initial state records the current main and production manifest, so enabling CD does not downgrade a production scope release. Keep required validation job names stable; renaming them requires commissioning the updated controller before merging the workflow change.

For initial commissioning, copy the tested `cd.nix`, `cd-build.sh`, `cd.mjs`, `checkpoint.mjs` and `bootstrap-cd.sh` together to the host, then run `sudo bash bootstrap-cd.sh`. The bootstrap records the current main and active manifest, adds a stable NixOS import, activates only the CD infrastructure, and restores the old configuration/closure if setup fails. It refuses to overwrite existing CD state. Subsequent updates travel through main. To prepare a complete release without contacting a server, use `node scripts/deploy-production.mjs --build-only /path/to/output` from a clean checkout.

Check deployment state without displaying secrets:

```sh
sudo systemctl status kaordo-cd.timer kaordo-cd.service kaordo-cd-activate.service
sudo journalctl -u kaordo-cd.service -u kaordo-cd-activate.service
sudo cat /var/lib/kaordo-cd/state.json
sudo cat /var/lib/kaordo-cd/checkpoint.json
```

State contains commit hashes, CI evidence, status and error summaries. An activation owns the shared host lock and continues through a newer push or poller rebuild. Failed attempts do not loop; a new successful CI attempt can retry. After a power loss or interrupted activation, inspect services and the active manifest before clearing its failure state or a stale lock. Never clear a lock held by a running deployment.

Manual commands remain available for an explicitly authorized recovery or release ([releases](../../docs/releases.md)). Both require a clean tree (`--allow-dirty` marks an intentional exception) and share the CD host lock. SSH uses `KAORDO_DEPLOY_SSH_KEY` or the default key, and the account needs non-interactive `sudo`.

```sh
KAORDO_DEPLOY_HOST=nixos@192.168.178.81 pnpm deploy:production
```

`deploy:production` runs the frontend, deployment and Go checks, cross-builds Kerno, Nodo and regado-agent for Linux amd64, and uploads one checksummed bundle. The bundle holds the apps, NixOS configuration, and Keycloak policy and theme; migrations are embedded in Kerno. A source change during the build aborts. On the host, `deploy-release.sh`:

1. builds the NixOS closure and verifies the manifest;
2. snapshots the current Keycloak policy for rollback;
3. installs the binaries and switches NixOS; Kerno applies pending migrations as it starts;
4. reconciles Keycloak and activates the frontend;
5. runs `verify-release.mjs`. This checks active services and timers, running binaries against installed ones, every app against the manifest, OIDC discovery, the login form and theme, and the LiveKit and Prometheus endpoints.

Any failure restores the previous frontend, binaries, closure, configuration and Keycloak policy. Migrations are not rolled back, so they must stay compatible with the previous release. The active release is recorded in `/srv/kaordo/releases/current`.

### Deployment checkpoints

Automatic deployment first briefly stops Kerno, Nodo and Keycloak to drain writes, dumps both PostgreSQL databases and snapshots media read-only, then resumes the services. Restic encrypts the matching data, runtime secrets and NixOS configuration in `/srv/kaordo/deployment-backups`; its random password stays in the root-only secrets directory. The controller checks repository metadata, reads back both dumps and restores them into disposable databases before deployment. Restore errors block deployment; temporary databases, dumps and media snapshots are removed. Backup commands suppress output containing data or credentials. Five verified checkpoints are retained in this dedicated repository.

These checkpoints share the production disks. They help recover from a release error but are **not an independent backup**. They do not continuously back up new writes, and the metadata check is not a full read of every historical media pack. Configure an independent encrypted destination and preserve its recovery password for server/disk-loss recovery. Checkpoints may contain clear account/profile metadata and server credentials inside restic encryption; account private keys and recovery secrets remain on user devices. Database restore is an operator recovery action, never an automatic rollback that could overwrite writes made after activation.

```sh
KAORDO_DEPLOY_HOST=nixos@192.168.178.81 pnpm deploy:pages:production
```

`deploy:pages:production` replaces only the static apps, and only from the same commit as the active full release. It rejects bundles containing local service URLs, switches `www/current` atomically, and restores the previous release if a post-check fails.

## Secrets

Secrets never enter Git or the Nix store. `provision-secrets.sh` idempotently creates root-only files under `/srv/kaordo/secrets`. Provide the Namecheap password in `/srv/kaordo/secrets/namecheap-ddns` (mode 0600). A protected ntfy topic for Regado alerts needs `KAORDO_NTFY_TOKEN=<token>` in `/srv/kaordo/secrets/kerno.env`; public topics need none.

## Storage layout

`storage.nix` mounts the system and data from Btrfs subvolumes of `Data1`: `@root`, `@nix`, `@log` and `@kaordo`, with nested `postgresql`, `media`, `prometheus` and `releases` subvolumes. Every disk uses the same GPT template, a 2 MiB BIOS boot partition and one pool partition. GRUB is installed on every present pool disk named in regado-agent's desired state, so a pool of one or more disks boots from any of them. Mounts are not bound to a member device, so replacing a disk through Regado keeps services running. The `degraded` boot entry mounts the remaining copy when a member is missing.

Production moved into this layout on 2026-10-10; [the migration record](../../docs/storage-migration-2026-10-10.md) lists its steps, revisions and checks.

## Manual recovery

1. Build the apps with `pnpm build:pages:production`, and cross-build the Go services with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`.
2. Copy them to the host and run `nixos-rebuild switch`. Kerno applies pending migrations as it starts.
3. Run `node sync-keycloak-production.mjs`, which reads the bootstrap admin credential from the secrets directory.

## Operations

- **Administrators.** Roles are never inferred from usernames. Find the account by its exact Keycloak subject, then grant the role. Administrative actions are recorded in `admin_audit`.

  ```sh
  sudo -u kaordo psql -d kaordo -c "SELECT id, keycloak_sub, username FROM users WHERE username = 'DruckHeil'"
  sudo -u kaordo psql -d kaordo -c "INSERT INTO user_roles (user_id, role) VALUES ('<id>', 'admin')"
  ```

- **Verification badge.** Set it the same way: `INSERT INTO fluo_profiles (user_id, verified) VALUES ('<id>', true) ON CONFLICT (user_id) DO UPDATE SET verified = true`.
- **Journal.** Persistent journald is capped at 256 MiB, and the age limit starts at 14 days. The age limit is `cleanup.journalDays` in the host's desired state: 1, 7, 14, 30 or 90 days, or none. Regado's Logs tab edits it, and the agent writes `/var/lib/regado-agent/journald-retention.conf`, which survives rebuilds. After a reinstall the agent reapplies the desired value.
- **DNS.** `ddclient.service` is a oneshot, so between runs it is normally `inactive (dead)`. Check `ddclient.timer` and the last result before treating that as a failure.
- **Health.** Check `systemctl --failed`, `ddclient.timer`, the agent's integrity operations, `127.0.0.1:8081/healthz` (Kerno) and `127.0.0.1:8082/healthz` (Nodo).
- **Backups.** RAID1 is not a backup. Configure an encrypted restic repository on an independent device or remote storage, keep a recoverable copy of its password, and schedule it before treating production data as backed up.
