# Kaordo on NixOS

The host uses one 64 GiB ext4 root partition labeled `NisOS`. The remaining
867.5 GiB on that drive and 867.5 GiB on the second drive form the Btrfs
filesystem `Data1`, mounted at `/srv/kaordo` with RAID1 data and metadata.
The first 64 GiB of the second drive is deliberately unallocated. `Data1`
provides about 867 GiB of usable mirrored space, not 1.7 TiB. NixOS is
installed only on the first drive.

`kaordo.nix` is imported by `/etc/nixos/configuration.nix`. PostgreSQL,
Keycloak, LiveKit, Kerno, Nodo, Caddy, and ddclient are systemd services.
The application database, media, website, and runtime secrets live on
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

Never put runtime secrets in Git or the Nix store. The idempotent
`provision-secrets.sh` creates root-readable files in
`/srv/kaordo/secrets`; provide the Namecheap password separately in
`/srv/kaordo/secrets/namecheap-ddns` with mode 0600. The production realm
file must be named `kaordo-realm.json` so Keycloak imports it. The NixOS
module recreates its import symlink whenever Keycloak starts.

Build static apps with `pnpm build:pages` and cross-build Kerno and Nodo for
Linux amd64 with `CGO_ENABLED=0`. Copy release files to `Data1`, run
`nixos-rebuild switch`, then run `apply-migrations.sh`. It applies the SQL
files in numeric order as the `kaordo` database role. Running them as
`postgres` leaves application tables inaccessible to Kerno. Run
`sync-keycloak-production.mjs` with Node.js afterward. That script reads
the bootstrap admin credential from the mirrored root-only secret file and
synchronizes registration, TOTP, recovery codes, scopes, and the API audience.
Kerno uses Keycloak's local backchannel for discovery and signing keys while
still validating the public HTTPS issuer in tokens.

Check `systemctl --failed`, the `ddclient.timer` and
`btrfs-scrub-srv-kaordo.timer`, and the local service health endpoints
`127.0.0.1:8081/healthz` and `127.0.0.1:8082/healthz`. Caddy retries ACME
certificate issuance automatically after TCP 443 becomes reachable.

RAID1 protects against one data disk failing. It does not protect against
deletion, corruption propagated to both disks, or loss of the host. Configure
an encrypted restic repository on an independent third device or remote
storage before treating the deployment as backed up.
