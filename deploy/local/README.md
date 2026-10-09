# Local stack

`pnpm dev` is the supported way to run Kaordo locally. It:

1. creates the ignored `deploy/local/.env` and root `.env` from their examples with random secrets when they are missing;
2. starts `compose.yaml`: application PostgreSQL, Keycloak with its own PostgreSQL, and LiveKit;
3. reconciles Keycloak policy (`pnpm auth:configure`) and applies every migration;
4. builds and runs Kerno and Nodo;
5. serves each app's Vite server behind one origin.

Frontend edits reload through HMR. Restart after Go changes or after adding an app. Only one instance may run per checkout; a second launch exits if a port is taken. `pnpm dev:stop` stops the processes this checkout started and the containers. It never kills unrelated port owners.

| Address          | Service                                         |
| ---------------- | ----------------------------------------------- |
| `localhost:8765` | Site origin (Portal and app proxies)            |
| `18766`–`18771`  | Per-app Vite servers                            |
| `localhost:8080` | Keycloak (use `localhost`, not `127.0.0.1`)     |
| `127.0.0.1:8081` | Kerno                                           |
| `127.0.0.1:8082` | Nodo (media under ignored `deploy/local/media`) |
| `127.0.0.1:7880` | LiveKit signaling; RTC on TCP 7881 and UDP 7882 |

`pnpm dev:web` serves the static build without services, for layout work only. Regado's host views report unavailable data locally because Compose runs neither regado-agent nor Prometheus.

The Keycloak realm JSON is imported only into an empty identity database. `pnpm auth:configure` reconciles registration, TOTP and recovery codes, session lifetimes, scopes and the Kerno audience on existing realms and verifies an issued token.

## Backups

`pnpm backup:local` streams `pg_dump` of both databases and the media directory into an encrypted [restic](https://restic.net) repository. `pnpm backup:verify` runs `restic check --read-data`, restores the latest set into temporary databases and verifies them. Neither command writes plaintext dumps or touches the active databases.

```sh
export RESTIC_REPOSITORY=/Volumes/BackupDrive/kaordo-restic
export RESTIC_PASSWORD_FILE="$HOME/.config/kaordo/restic-password" # mode 0600, kept elsewhere too
restic init # new repository only
pnpm backup:local
pnpm backup:verify
```

The repository must be on a separate physical disk or remote storage. The dumps and media are taken at different moments, so pause writes when you need a coordinated point. Scheduling is not automated.
