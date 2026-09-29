# Kaordo

Kaordo is being rebuilt as independent applications in one repository. The first functional slice provides local account registration and sign-in through Keycloak, TOTP, and a shared Kerno identity API. Messaging, social, community, and administration features remain scaffolds.

## Layout

| Path | Responsibility |
| --- | --- |
| `apps/portal` | Public entry point |
| `apps/ligo` | Messaging frontend |
| `apps/fluo` | Social frontend |
| `apps/rondo` | Community frontend |
| `apps/regado` | Administration frontend |
| `packages/ui` | Shared STaSBLR components with the Rhea style |
| `packages/auth`, `api-client`, `account-ui`, `contracts`, `crypto`, `links` | Shared authentication, API, account UI, contracts, and integration points |
| `services/kerno` | Go API and metadata coordinator |
| `services/nodo` | Go file storage and tus uploads |
| `deploy` | Local Keycloak/PostgreSQL authentication stack and future service configuration |

Every frontend is a separate SvelteKit static build. `build:pages` assembles them under one Pages artifact: `/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. The UI package owns shadcn-svelte components, Bits UI primitives, Lucide icons, and the official Rhea preset.

## Run locally

With Docker running, use these commands from the repository root:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:8765/register/` to create an account or `http://localhost:8765/login/` to sign in. The command creates ignored local configuration if missing, starts PostgreSQL and Keycloak, builds Kerno and the five static apps, then serves them on one origin. Press Ctrl+C to stop Kerno and the site; run `pnpm dev:stop` to stop the containers. For the frontend alone, use `pnpm dev:web`; account actions need the full stack. Restart `pnpm dev` after frontend source changes to rebuild the static apps.

The [local setup details](deploy/local/README.md) describe the services and configuration. Database and administrator passwords stay in the ignored `deploy/local/.env`.

The [technical specification](docs/kaordo-technical-spec.txt) defines the identity and token contract.
`packages/contracts/openapi.yaml` generates the shared TypeScript API types with `pnpm --filter @kaordo/contracts generate`.

## Checks

```sh
pnpm install
pnpm dev
pnpm build:pages
pnpm test:pages
node --test scripts/auth-config.test.mjs
go test ./services/kerno/...
go build ./services/kerno/... ./services/nodo/...
```

The other product modules and Nodo remain scaffolds. The current authentication stack is local and has not been deployed as a public service.

The complete previous codebase and Git history are preserved outside this repository at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`.

The [ISO/IEC 25010:2023 gap audit](docs/audits/iso-iec-25010-2023-scope-0.0.1.md) records current evidence and release blockers for this scaffold.
