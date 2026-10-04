# Kaordo on NixOS

The host uses one 64 GiB ext4 root partition labeled `NixOS`. The remaining
867.5 GiB on that drive and 867.5 GiB on the second drive form the Btrfs
filesystem `Data1`, mounted at `/srv/kaordo` with RAID1 data and metadata.
The first 64 GiB of the second drive is available for role allocation. `Data1`
provides about 867 GiB of usable mirrored space, not 1.7 TiB. NixOS is
installed only on the root-owning drive (currently `/dev/sdb`). Device names are
observations, not discovery rules.

`kaordo.nix` is imported by `/etc/nixos/configuration.nix`. PostgreSQL,
Keycloak, LiveKit, Kerno, Nodo, Caddy, ddclient, Prometheus, Node Exporter,
and the local Regado agent are systemd services. Prometheus and Node Exporter
listen only on loopback; Kerno is their only public API gateway. The agent
listens on a Unix socket readable by Kerno's supplementary group.
The application database, media, website, metrics, and runtime secrets live on
`Data1`. Static apps are served from `/srv/kaordo/www/current`.

## Network

Namecheap Dynamic DNS updates `kaordo.link` once per minute. The DNS
record's observed authoritative TTL is 180 seconds. Configure persistent
FRITZ!Box port shares to `192.168.178.81`:

| External | Protocol | Purpose |
| --- | --- | --- |
| 443 | TCP | HTTPS, Keycloak, API, LiveKit signalling, ACME TLS challenge |
| 7881 | TCP | LiveKit RTC fallback |
| 7882 | UDP | LiveKit RTC media |
| 3478 | UDP | LiveKit TURN |

TCP 80 is useful for HTTP redirects and an alternate ACME challenge, but was
already forwarded to another LAN device during installation. Caddy can issue
the certificate using TCP 443 alone. The FRITZ!Box rejected UPnP port mapping
requests, so manual shares are required. Do not forward PostgreSQL, Keycloak
port 8080, Kerno port 8081, Nodo port 8082, or LiveKit port 7880.
The Keycloak administrator API is not published through Caddy; access it over
an SSH port forward when needed.

## Provisioning and updates

Deploy only the static applications with:

```sh
KAORDO_DEPLOY_HOST=nixos@192.168.178.81 pnpm deploy:pages:production
```

The command requires a clean Git tree by default; `--allow-dirty` explicitly
marks an intentional uncommitted release. It builds with the public HTTPS
origin, scans every production JavaScript bundle for local service URLs, tests
the static artifact, uploads a checksummed release, and asks the server to
verify Kerno, Nodo, Keycloak and Caddy before switching `www/current`. The
switch is atomic. It compares the served Portal and Regado HTML with the new
release and rechecks the auth iframes and service health; any failed post-check
restores the previous symlink. Old releases and rollback targets are retained.
This command deploys frontend files only; it does not run migrations or replace
backend binaries. SSH uses `KAORDO_DEPLOY_SSH_KEY` when set, otherwise the
standard `~/.ssh/id_ed25519` key or OpenSSH configuration.

Never put runtime secrets in Git or the Nix store. The idempotent
`provision-secrets.sh` creates root-readable files in
`/srv/kaordo/secrets`; provide the Namecheap password separately in
`/srv/kaordo/secrets/namecheap-ddns` with mode 0600. The production realm
file must be named `kaordo-realm.json` so Keycloak imports it. The NixOS
module recreates its import symlink whenever Keycloak starts.

Build static apps with `pnpm build:pages:production` and cross-build Kerno, Nodo, and
Regado Agent for Linux amd64 with `CGO_ENABLED=0`. Copy release files to
`Data1`, run `apply-migrations.sh`, then run `nixos-rebuild switch`. Migrations
must precede a Kerno restart because Kerno requires the Regado tables. It applies the SQL
files in numeric order as the `kaordo` database role. Running them as
`postgres` leaves application tables inaccessible to Kerno. Run
`sync-keycloak-production.mjs` with Node.js afterward. That script reads
the bootstrap admin credential from the mirrored root-only secret file and
synchronizes registration, TOTP, recovery codes, scopes, and the API audience.
Kerno uses Keycloak's local backchannel for discovery and signing keys while
still validating the public HTTPS issuer in tokens.

Regado roles are not inferred from usernames. Grant the `admin` role to the
existing DruckHeil account by verifying its exact Kaordo user ID and
Keycloak subject in PostgreSQL, then inserting that ID into `user_roles`.
Do not create an administrator merely because an account chooses the name
`DruckHeil`. Admin operations and content access cases are written to
`admin_audit`. Supported system actions include fixed restarts of Nodo, LiveKit
or ddclient, reviewed Disko/systemd-repart layouts, and background check/repair of a
selected mounted Btrfs data pool. Check refreshes checksum and file inventory
evidence; repair restores mirror placement and repairs from valid copies.
Nodo independently audits upload references and only cleans expired unused
artifacts after a fresh reference/retention check. The agent needs writable
`/var/lib/btrfs` for scrub history; the module supplies this sandbox path.
SMART reads use smartmontools and are cached for five minutes. Standby disks
are not deliberately awakened for a dashboard refresh. Unsupported health
checks are shown as unavailable rather than being counted as healthy.

Prometheus uses a bind mount from `/srv/kaordo/prometheus` into its standard
state directory. When enabling it on an existing deployment, stop Prometheus,
copy its existing `/var/lib/prometheus2` contents into the mirrored directory,
and apply the NixOS configuration. Preserve the old copy until the metrics
history is verified after startup.

Check `systemctl --failed`, the `ddclient.timer` and
`btrfs-scrub-srv-kaordo.timer`, and the local service health endpoints
`127.0.0.1:8081/healthz` and `127.0.0.1:8082/healthz`. Caddy retries ACME
certificate issuance automatically after TCP 443 becomes reachable.

RAID1 protects against one data disk failing. It does not protect against
deletion, corruption propagated to both disks, or loss of the host. Configure
an encrypted restic repository on an independent third device or remote
storage before treating the deployment as backed up.

## Source and verification boundaries

Service entry points now separate configuration/wiring from feature behavior. Kerno/Nodo drain HTTP before closing pools and background processing; service paths and environment contracts stay compatible with this module. The maintainability refactor does not itself rebuild or deploy the remote host. Run the [local verification matrix](../../docs/refactoring.md) before an explicitly authorized release and recheck host health afterward.

The network observations above describe provisioning, not a fresh reachability check. Recheck router shares, DNS and TURN from an external network before making public call-availability claims.

## Declarative role allocation

The module installs Disko from the pinned NixOS package set, systemd-repart,
btrfs-progs and filesystem tools. Regado's protected agent stages approvals in
`/var/lib/regado-agent`; Nix uses its pinned `NIX_PATH` and a private writable
`/tmp`. `kaordo-system-volumes.service` mounts prepared ext4 System partitions
by UUID through host systemd. These are data volumes, not automatically installed
operating systems. The current root is still the only NixOS installation.

Blank-device initialization is explicit and reviewed. NixOS rebuilds never
apply a pending Disko declaration. On existing devices systemd-repart is run
with `--empty=refuse`, first as a dry run, and may only preserve/add or grow
partitions. Offline shrink/move/OS installation is a separate operator workflow.
Read the [tool selection and verification](../storage/README.md).

Before enabling this agent version, install its new binary together with the
module: the new mount oneshot requires `--mount-system-volumes`. Build the NixOS
closure first, retain previous binaries/module/closure, switch once, and check
the protected socket plus Kerno/Nodo/Keycloak/Caddy health before switching the
static frontend. Existing disk sizes and boot UUIDs are preserved by deployment.
