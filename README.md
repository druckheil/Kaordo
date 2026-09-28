# Kaordo

Kaordo is being rebuilt as independent applications in one repository. Scope 0.0.1 contains project boundaries and dependency wiring only.

## Layout

| Path | Responsibility |
| --- | --- |
| `apps/portal` | Public entry point |
| `apps/ligo` | Messaging frontend |
| `apps/fluo` | Social frontend |
| `apps/rondo` | Community frontend |
| `apps/regado` | Administration frontend |
| `packages/ui` | Shared STaSBLR components with the Rhea style |
| `packages/auth`, `api-client`, `contracts`, `crypto`, `links` | Shared browser contracts and integration points |
| `services/kerno` | Go API and metadata coordinator |
| `services/nodo` | Go file storage and tus uploads |
| `deploy` | Future local infrastructure and Cloudflare edge configuration |

Every frontend is a separate SvelteKit static build. `build:pages` assembles them under one Pages artifact: `/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. The UI package owns shadcn-svelte components, Bits UI primitives, Lucide icons, and the official Rhea preset.

## Local commands

```sh
pnpm install
pnpm --filter @kaordo/portal dev
pnpm build:pages
go build ./services/kerno/... ./services/nodo/...
```

The Go binaries and frontend pages are scaffolds. Server processes, authentication, data schemas, chat, uploads, and media delivery are scheduled for later scopes.

The complete previous codebase and Git history are preserved outside this repository at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`.
