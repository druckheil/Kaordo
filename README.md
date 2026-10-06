# Kaordo

Kaordo is being rebuilt as independent applications in one repository. Local account registration and sign-in use Keycloak, TOTP, and a shared Kerno identity API. Fluo has a social feed with posts, interactions, and photo/video uploads through Nodo. Ligo has direct and group chats, message reactions and file attachments. Rondo has community servers, text channels and local LiveKit rooms for voice, camera and screen sharing. Regado provides administrator-only account, audit, storage, service-log and system views.

## Layout

| Path | Responsibility |
| --- | --- |
| `apps/portal` | Public entry point |
| `apps/ligo` | Messaging frontend |
| `apps/fluo` | Social frontend |
| `apps/rondo` | Community frontend |
| `apps/regado` | Administration frontend |
| `packages/ui` | Shared STaSBRL components with the Rhea style |
| `packages/auth`, `api-client`, `account-ui`, `chat-ui`, `contracts`, `crypto`, `links`, `media-client`, `media-ui`, `voice-client` | Shared authentication, typed API, account and chat UI, contracts, links, media upload, and LiveKit client |
| `services/kerno` | Go API and metadata coordinator |
| `services/nodo` | Go file storage and tus uploads |
| `services/mediaauth` | Shared media URL signing and verification |
| `services/regado-agent` | Restricted Linux monitoring and maintenance over a Unix socket |
| `deploy` | Local Compose and production NixOS profiles |

Every frontend is a separate SvelteKit static build. `build:pages` assembles them under one Pages artifact: `/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. The UI package owns shadcn-svelte components, Bits UI primitives, Lucide icons, and the official Rhea preset. The rightmost header control opens `/agordoj/`, where users select Deep Purple (the default), Discord, Leadgen, Lara, Damon, Party Rock or Japan Blues. The shared theme and independent light/dark mode persist across navigation, reload and tabs; the initial mode follows the operating system.

## Run locally

With Docker running, use these commands from the repository root:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:8765/register/` to create an account or `http://localhost:8765/login/` to sign in. After signing in, open `/fluo/`, `/ligo/` or `/rondo/` on the same origin. The command creates ignored local configuration if missing, starts PostgreSQL, Keycloak and LiveKit, applies the application migrations, builds Kerno and Nodo, then starts five Vite development servers behind one local origin. Frontend edits update through Vite HMR without restarting `pnpm dev`; the production build remains static. Install `ffmpeg` and `ffprobe` to process videos. Press Ctrl+C to stop Kerno, Nodo and the frontend servers, or run `pnpm dev:stop` from another terminal to stop those processes and the Docker containers together. For a static frontend-only preview, use `pnpm dev:web`; account and product actions need the full stack.

The [local setup details](deploy/local/README.md) describe the services and configuration. Database and administrator passwords stay in the ignored `deploy/local/.env`.

The [technical specification](docs/kaordo-technical-spec.txt) defines the identity and token contract.
`packages/contracts/openapi.yaml` generates the shared TypeScript API types with `pnpm --filter @kaordo/contracts generate`.

## Checks

```sh
pnpm check:front
pnpm --filter @kaordo/contracts generate
pnpm test:pages
pnpm test:unit
pnpm test:ui
pnpm test:integration # built static apps; Docker, ffmpeg and restic available
pnpm test:auth
pnpm test:dev
pnpm test:media
pnpm test:dependencies
pnpm test:ui-layout
pnpm test:product:ui
pnpm test:regado:ui
pnpm exec playwright test --project=browser ui-public.test.mjs
pnpm test:product:db # disposable database; covers Fluo, Ligo, Rondo and Regado
pnpm test:auth:live # pnpm dev running in another terminal
pnpm test:backup
pnpm test:backup:live # both local database containers running
pnpm audit --audit-level=low
go test -race ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
go vet ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
go build ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
```

The [CI guide](docs/ci.md) defines GitHub job ownership, local reproduction, caching, failure diagnostics and rules for new tests. Headless fixture tests cover product interaction without manual site browsing. Live tests add real identity, persistence, media processing and call integration. The [refactor review](docs/refactoring.md) records current module ownership, fixes and verification; [scripts](scripts/README.md) documents tooling.

## Deployment and remaining boundaries

The [NixOS production profile](deploy/nixos/README.md) uses Caddy HTTPS at `kaordo.link`, Namecheap DDNS, LiveKit, Prometheus/Node Exporter and the restricted Regado agent. Production Data1 mirrors data and metadata across two physical disks; NixOS has one separate 64 GiB root. The local Compose profile has no public TURN/TLS, Linux agent or Prometheus. Regado remains accessible only by direct route and database administrator role; it is absent from the public app directory.

Messages/posts and media are not end-to-end encrypted, and user/system escrow keys do not exist. Regado's audited time-limited content access is not key recovery. RAID1 does not replace independent backups; an external restic destination, recoverable key copy and schedule remain operator requirements. Notifications and complete account settings are unfinished. Cloudflare and Synapse integrations are reserved rather than active in the NixOS profile.

The complete previous codebase and Git history are preserved outside this repository at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`.

The [dated ISO/IEC 25010:2023 audit](docs/audits/iso-iec-25010-2023-current.md) records the account, Fluo, Ligo and Nodo assessment from 1 October 2026. Its scores and scope are historical; they do not certify subsequent Rondo/Regado or refactor changes. The [original scaffold audit](docs/audits/iso-iec-25010-2023-scope-0.0.1.md) remains available for historical comparison.
