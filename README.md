# Kaordo

Kaordo is being rebuilt as independent applications in one repository. Local account registration and sign-in use Keycloak, TOTP, and a shared Kerno identity API. Fluo has a social feed with posts, interactions, and photo/video uploads through Nodo. Ligo has direct and group chats, message reactions and file attachments. Rondo has community servers, text channels and local LiveKit rooms for voice, camera and screen sharing. Administration remains a scaffold.

## Layout

| Path | Responsibility |
| --- | --- |
| `apps/portal` | Public entry point |
| `apps/ligo` | Messaging frontend |
| `apps/fluo` | Social frontend |
| `apps/rondo` | Community frontend |
| `apps/regado` | Administration frontend |
| `packages/ui` | Shared STaSBLR components with the Rhea style |
| `packages/auth`, `api-client`, `account-ui`, `chat-ui`, `contracts`, `crypto`, `links`, `media-client`, `voice-client` | Shared authentication, typed API, account and chat UI, contracts, links, media upload, and LiveKit client |
| `services/kerno` | Go API and metadata coordinator |
| `services/nodo` | Go file storage and tus uploads |
| `deploy` | Local Keycloak, PostgreSQL and LiveKit configuration |

Every frontend is a separate SvelteKit static build. `build:pages` assembles them under one Pages artifact: `/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. The UI package owns shadcn-svelte components, Bits UI primitives, Lucide icons, and the official Rhea preset.

## Run locally

With Docker running, use these commands from the repository root:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:8765/register/` to create an account or `http://localhost:8765/login/` to sign in. After signing in, open `/fluo/`, `/ligo/` or `/rondo/` on the same origin. The command creates ignored local configuration if missing, starts PostgreSQL, Keycloak and LiveKit, applies the application migrations, builds Kerno, Nodo and the static apps, then serves them on one origin. Install `ffmpeg` and `ffprobe` to process videos. Press Ctrl+C to stop Kerno, Nodo and the site, or run `pnpm dev:stop` from another terminal to stop those processes and the Docker containers together. For the frontend alone, use `pnpm dev:web`; account and product actions need the full stack. Restart `pnpm dev` after frontend source changes to rebuild the static apps.

The [local setup details](deploy/local/README.md) describe the services and configuration. Database and administrator passwords stay in the ignored `deploy/local/.env`.

The [technical specification](docs/kaordo-technical-spec.txt) defines the identity and token contract.
`packages/contracts/openapi.yaml` generates the shared TypeScript API types with `pnpm --filter @kaordo/contracts generate`.

## Checks

```sh
pnpm install
pnpm dev
pnpm build:pages
pnpm test:pages
pnpm test:auth
pnpm test:dev
pnpm test:media
pnpm test:dependencies
pnpm test:ui-layout
pnpm test:ui-public
pnpm test:auth:live # while pnpm dev runs in another terminal
pnpm test:product:db # with the local application database running; covers Fluo and Ligo
pnpm test:backup
pnpm test:backup:live # with the local database containers running
go test ./services/kerno/...
go test ./services/nodo/... ./services/mediaauth/...
go build ./services/kerno/... ./services/nodo/... ./services/mediaauth/...
```

Regado remains a scaffold. The current stack is local and has not been deployed as a public service. Rondo voice uses self-hosted LiveKit; the development profile has no public TURN/TLS or UDP ingress, so remote voice is not yet available through Cloudflare Tunnel alone. Rondo messages and voice are not end-to-end encrypted. Nodo removes unreferenced uploads after 24 hours and Kerno requests immediate cleanup when Fluo posts or Ligo/Rondo messages are deleted. Stored media still has no disk mirror or private-at-rest encryption; see the local storage and backup notes before relying on it for durable files.

The complete previous codebase and Git history are preserved outside this repository at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`.

The [current ISO/IEC 25010:2023 audit](docs/audits/iso-iec-25010-2023-current.md) scores every characteristic and subcharacteristic for the implemented account, Fluo, Ligo and Nodo slice, with reproducible evidence and remaining release blockers. The [original scaffold audit](docs/audits/iso-iec-25010-2023-scope-0.0.1.md) remains available for historical comparison.
