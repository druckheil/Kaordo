# Production (NixOS)

`kaordo.nix` is imported by `/etc/nixos/configuration.nix`. It runs PostgreSQL, Keycloak, LiveKit, Kerno, Nodo, Caddy (HTTPS for `kaordo.link`), ddclient (Namecheap DDNS, every minute), Prometheus, Node Exporter and regado-agent as systemd services. Prometheus and Node Exporter listen on loopback only, and Kerno is the only way to reach them. Databases, media, static releases (`/srv/kaordo/www/current`), metrics and secrets live on `Data1`, a Btrfs pool with two copies (RAID1) across both disks, mounted at `/srv/kaordo`. Until the system moves into the pool (below), the NixOS root is a separate ext4 partition on one disk and is not mirrored. [Regado](../../docs/regado.md) manages the pool's devices.

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

Deployments are operator actions for an explicitly authorized release ([releases](../../docs/releases.md)). Both commands require a clean tree (`--allow-dirty` marks an intentional exception) and share one host lock. SSH uses `KAORDO_DEPLOY_SSH_KEY` or the default key, and the account needs non-interactive `sudo`.

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

```sh
KAORDO_DEPLOY_HOST=nixos@192.168.178.81 pnpm deploy:pages:production
```

`deploy:pages:production` replaces only the static apps, and only from the same commit as the active full release. It rejects bundles containing local service URLs, switches `www/current` atomically, and restores the previous release if a post-check fails.

## Secrets

Secrets never enter Git or the Nix store. `provision-secrets.sh` idempotently creates root-only files under `/srv/kaordo/secrets`. Provide the Namecheap password in `/srv/kaordo/secrets/namecheap-ddns` (mode 0600). A protected ntfy topic for Regado alerts needs `KAORDO_NTFY_TOKEN=<token>` in `/srv/kaordo/secrets/kerno.env`; public topics need none.

## Moving the system into the pool

`storage.nix` mounts the system and data from Btrfs subvolumes of `Data1` (`@root`, `@nix`, `@log`, `@kaordo` with nested `postgresql`, `media`, `prometheus` and `releases`). It installs GRUB on every pool disk named in the agent's desired state, and its `degraded` boot entry mounts the remaining copy after a disk failed. A host that still boots from its ext4 root moves in place with `migrate-to-pool.sh`, run as root from `/etc/nixos/deploy/nixos`:

1. `check` verifies two healthy RAID1 members and free space.
2. `prepare` copies the running system into `@root`, `@nix` and `@log`, imports `storage.nix` into the copy's configuration and builds it. Services keep running.
3. `cutover` stops the services, syncs the system again, and reflinks the data into `@kaordo`; the copy shares every block and its paths, sizes, ownership, permissions and timestamps are checked. It records the copied entries, validates the GRUB menu and arms one trial boot. A failure restarts the previously active services. The operator then reboots; physical or iLO access must be available if SSH does not return.
4. `finalize`, on the recorded trial system, checks the subvolume mounts and service health, makes it the default and installs GRUB on every pool disk. If the trial boot hangs instead, power-cycling starts the old system. Its data is the copy from cutover: writes accepted by the trial system need reconciliation before a later rollback.
5. `cleanup` requires successful finalization and removes only the pre-migration entries recorded during cutover. New entries and subvolumes remain intact. It permanently retires the old application's data copy.

The stages share the production deployment lock. Do not deploy another release between preparation and finalization. Keep an encrypted recovery copy on an independent device before retiring the old root or reshaping partitions; the pool copy is not a backup.

Afterwards the old ext4 partition only backs older boot entries. A two-device RAID1 cannot remove one member while preserving two copies. Completing the uniform template therefore needs a separately rehearsed partition migration or a third temporary device; do not drop and re-add a disk from this two-device pool. The in-place system migration itself leaves partition boundaries unchanged.

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
