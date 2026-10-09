# Production (NixOS)

`kaordo.nix` is imported by `/etc/nixos/configuration.nix`. It runs PostgreSQL, Keycloak, LiveKit, Kerno, Nodo, Caddy (HTTPS for `kaordo.link`), ddclient (Namecheap DDNS, every minute), Prometheus, Node Exporter and regado-agent as systemd services. Prometheus and Node Exporter listen on loopback only, and Kerno is the only way to reach them. Databases, media, static releases (`/srv/kaordo/www/current`), metrics and secrets live on [`Data1`](../storage/README.md).

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

`deploy:production` runs the frontend, deployment and Go checks, cross-builds Kerno, Nodo and regado-agent for Linux amd64, and uploads one checksummed bundle. The bundle holds the apps, NixOS configuration, Keycloak policy and theme, and migrations. A source change during the build aborts. On the host, `deploy-release.sh`:

1. builds the NixOS closure and verifies the manifest;
2. snapshots the current Keycloak policy for rollback;
3. applies migrations as `kaordo`, installs the binaries and switches NixOS;
4. reconciles Keycloak and activates the frontend;
5. runs `verify-release.mjs`. This checks active services and timers, running binaries against installed ones, every app against the manifest, OIDC discovery, the login form and theme, and the LiveKit and Prometheus endpoints.

Any failure restores the previous frontend, binaries, closure, configuration and Keycloak policy. Migrations are not rolled back, so they must stay compatible with the previous release. The active release is recorded in `/srv/kaordo/releases/current`.

```sh
KAORDO_DEPLOY_HOST=nixos@192.168.178.81 pnpm deploy:pages:production
```

`deploy:pages:production` replaces only the static apps, and only from the same commit as the active full release. It rejects bundles containing local service URLs, switches `www/current` atomically, and restores the previous release if a post-check fails.

## Secrets

Secrets never enter Git or the Nix store. `provision-secrets.sh` idempotently creates root-only files under `/srv/kaordo/secrets`. Provide the Namecheap password in `/srv/kaordo/secrets/namecheap-ddns` (mode 0600).

## Manual recovery

1. Build the apps with `pnpm build:pages:production`, and cross-build the Go services with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`.
2. Copy them to the host and run `apply-migrations.sh`, which applies every migration as `kaordo`. Kerno will not start without its tables.
3. Run `nixos-rebuild switch`.
4. Run `node sync-keycloak-production.mjs`, which reads the bootstrap admin credential from the secrets directory.

## Operations

- **Administrators.** Roles are never inferred from usernames. To grant `admin`, verify the exact account ID and Keycloak subject in PostgreSQL, then insert the ID into `user_roles`. Administrative actions are recorded in `admin_audit`.
- **Journal.** Persistent journald is capped at 256 MiB, and the age limit starts at 14 days. Regado can change it to 1, 7, 14, 30 or 90 days, or remove the age limit. The choice is stored in `/var/lib/regado-agent/journald-retention.conf` and survives rebuilds.
- **DNS.** `ddclient.service` is a oneshot, so between runs it is normally `inactive (dead)`. Check `ddclient.timer` and the last result before treating that as a failure.
- **Health.** Check `systemctl --failed`, `ddclient.timer`, `btrfs-scrub-srv-kaordo.timer`, `127.0.0.1:8081/healthz` (Kerno) and `127.0.0.1:8082/healthz` (Nodo).
- **Backups.** RAID1 is not a backup. Configure an encrypted restic repository on an independent device or remote storage, keep a recoverable copy of its password, and schedule it before treating production data as backed up.
