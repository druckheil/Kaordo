# Kaordo

Self-hosted personal applications sharing one account:

- **Fluo**: social posts, profiles, presence and notifications.
- **Ligo**: direct, group and Saved messages chats.
- **Rondo**: communities with text channels and LiveKit calls.
- **Lingvo**: German vocabulary and phrase practice with FSRS scheduling.
- **Memoro**: calendar, daily tasks and journal.
- **Regado**: administration for accounts, storage, logs and host health.

User content is encrypted on the user's devices. The server stores ciphertext and the metadata it needs for routing and access control. See [encryption](docs/encryption.md).

## Repository

| Path                    | Contents                                                       |
| ----------------------- | -------------------------------------------------------------- |
| `apps/*`                | Independent static SvelteKit applications                      |
| `packages/*`            | Shared browser packages: UI, auth, API, crypto, chat and media |
| `services/kerno`        | Go API, authorization and PostgreSQL metadata                  |
| `services/nodo`         | Go tus uploads and media bytes                                 |
| `services/mediaauth`    | Signed media URLs shared by Kerno and Nodo                     |
| `services/regado-agent` | Fixed Linux operations behind a protected Unix socket          |
| `deploy/local`          | Docker Compose development stack                               |
| `deploy/nixos`          | Production NixOS module and release scripts                    |
| `deploy/postgres`       | Application schema migrations                                  |

## Run locally

Requires Node 24, pnpm, Go, Docker, `ffmpeg` and `ffprobe`.

```sh
pnpm install
pnpm dev
```

Open http://localhost:8765/register/. `pnpm dev` creates ignored local configuration, starts PostgreSQL, Keycloak and LiveKit, applies migrations, runs Kerno and Nodo, and serves every app with HMR behind one origin. Stop it with Ctrl+C, or with `pnpm dev:stop`, which also stops the containers. Details: [local stack](deploy/local/README.md).

## Checks

```sh
pnpm check:front && pnpm format:check && pnpm lint && pnpm knip
pnpm test:unit
pnpm lint:go
pnpm test:go
```

[CI](docs/ci.md) lists every suite and the services it needs.

## Documentation

- [Architecture](docs/architecture.md): components, ownership and data flows
- [Encryption](docs/encryption.md): keys, envelopes, recovery and threat model
- [CI](docs/ci.md): test layers, local reproduction and test rules
- [Releases](docs/releases.md): public release notes and release procedure
- [Production](deploy/nixos/README.md): NixOS host, deployment, rollback and operations
- [Migrations](deploy/postgres/README.md), [Keycloak](deploy/keycloak/README.md), [storage](deploy/storage/README.md)
