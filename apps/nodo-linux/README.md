# Kaordo Nodo for Linux

`kaordo-nodo` is the headless Linux host for Kaordo. It has no graphical
dependencies: it is a small Rust binary with a readable terminal interface,
the same direct HTTP/TUS storage protocol as the Android Nodo, and a systemd
user-service mode for unattended hosting.

## Quick start

```sh
# Sign in (the password prompt does not echo on a TTY)
kaordo-nodo login

# Allocate the disk. The Kaordo client assigns public/private space later.
kaordo-nodo setup --quota 30g

# Run in the current terminal, useful for first diagnostics
kaordo-nodo run

# Or install/enable a user-level background service
kaordo-nodo start
kaordo-nodo status
```

## Install the published Linux build

The current Ubuntu/Linux x86_64 build can be installed without a package
manager:

```sh
mkdir -p ~/.local/bin
curl --fail --location --proto '=https' --tlsv1.2 \
  -o ~/.local/bin/kaordo-nodo \
  https://kaordo.pages.dev/downloads/Kaordo-Nodo_0.1.4-11a_linux_x86_64
chmod 0755 ~/.local/bin/kaordo-nodo
export PATH="$HOME/.local/bin:$PATH"
kaordo-nodo login
```

The binary is served through Cloudflare Pages from the Kaordo R2 release
bucket. `kaordo-nodo update --apply` verifies the published SHA-256 manifest
before replacing the executable.

`setup` also works interactively when `--quota` is omitted. Supported storage
suffixes are `KB`, `MB`, `GB`, `KiB`, `MiB`, and `GiB`. The default listener is
TCP `49321`, matching Android Nodo. Use `--port` or `KAORDO_NODO_CONFIG` when
multiple Linux nodes share a host.

The service listens on both IPv4 and IPv6 when the host supports both. A VPS
firewall must allow the selected TCP port; on Ubuntu with UFW, for example:

```sh
sudo ufw allow 49321/tcp
sudo ss -lntp | grep 49321
```

If the node was installed as a user service, apply an update and restart it so
the new listener is active:

```sh
kaordo-nodo update --apply
kaordo-nodo restart
```

The guided setup first shows free and total disk space and asks only how much
the Nodo should allocate. Public/private space is assigned later by the
Kaordo client through the coordinator. Use `g` for gigabytes and `m` for
megabytes (`10g`, `500m`); a bare number in the guided prompt is treated as
gigabytes. Longer forms such as `GB`, `GiB`, `MB`, and `MiB` remain accepted.
The local node starts private-only until the client allocation arrives.

## Runtime layout

- Configuration and the session token: `$XDG_CONFIG_HOME/kaordo/nodo.json`
  (normally `~/.config/kaordo/nodo.json`, mode `0600`).
- Payloads: `$XDG_DATA_HOME/kaordo/nodo` (normally
  `~/.local/share/kaordo/nodo`). Set `KAORDO_NODO_DATA_DIR` before first setup
  to place payloads on a different disk.
- Reconciliation queue: `.reconciliation.json` beside the payloads. It keeps
  public tombstones and cleanup acknowledgements durable across restarts.
- User service: `~/.config/systemd/user/kaordo-nodo.service`.

The Worker stores compact ownership, tickets, quota, heartbeat and
reconciliation metadata. Payload bytes stay on this node and are transferred
directly by the client. The node validates short-lived access tickets with the
Worker and caches only non-reservation grants until their expiry.

## Commands

```text
login                    sign in and persist a protected session
logout                   remove the local session but keep payloads
setup                    choose total quota, name and port
run                      foreground mode
start / stop / restart   background systemd-user mode
status [--json]          local listener and storage status
install-service          write the systemd user unit without starting it
uninstall-service        disable and remove the unit
update                   check the HTTPS manifest
update --apply           download, SHA-256 verify and atomically replace the binary
```

Updates require an HTTPS manifest containing `version`, `linuxX86_64Url` (or
`linux_x86_64_url`) and `linuxX86_64Sha256` (or `linux_x86_64_sha256`). A
custom manifest can be selected with `updateManifestUrl` in the config. The
artifact is streamed to a temporary file, verified, then installed with a
rollback file. The service is intentionally not restarted automatically;
run `kaordo-nodo restart` after applying an update.

## Building locally

From the repository root:

```sh
cargo build -p kaordo-nodo-linux --release
./target/release/kaordo-nodo --help
```

For a reproducible Linux x86_64 build from macOS, install `zig` and
`cargo-zigbuild`, then run:

```sh
cargo zigbuild -p kaordo-nodo-linux --release --target x86_64-unknown-linux-gnu
```
