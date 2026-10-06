# Kaordo development guide

Product UI and all user-facing copy must be in English. Repository documentation is English; conversation with the user can use their language.

## Baseline and implemented scope

The rebuild started at scope 0.0.1 with a new Git root. The previous code and full history remain at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`. Do not restore old D1 schemas, wire formats, Tauri commands, or release artifacts for compatibility.

Implemented applications are Portal authentication/account entry, Fluo social posting, Ligo messaging, Rondo communities and LiveKit calls, and Regado administration. Notifications, complete settings, Matrix integration, content encryption and cryptographic recovery remain incomplete or reserved. Describe actual capabilities and evidence, not the scaffold's original plans.

## Architecture

- Independent static SvelteKit apps live in `apps/`. Shared browser behavior lives in `packages/`; each package declares the dependencies it imports.
- `packages/ui` owns Tailwind tokens, shadcn-svelte Rhea components, Bits UI behavior and Lucide icons. Compose these components rather than reimplementing their interaction primitives.
- `contracts/openapi.yaml` defines service routes and wire schemas. Generate TypeScript types; do not edit generated `openapi.d.ts` or PostgreSQL Jet tables/models manually.
- `auth` owns in-memory OIDC tokens; `account-ui` owns account gates and the presentation-only session preview. `api-client` owns requests, retry, TanStack Query options and shared message-cache updates. UI components own rendering and interaction.
- `chat-ui` owns the shared composer, bubbles, grouping and native message scrolling for Ligo and Rondo. `media-client` owns uploads/image resizing; `media-ui` owns PhotoSwipe, Vidstack and media geometry; `voice-client` owns LiveKit tracks and interface sounds.
- Four Go modules are in `go.work`: Kerno coordinates business metadata/access; Nodo owns tus uploads and bytes; mediaauth signs/verifies media links; regado-agent exposes fixed Linux operations through a protected Unix socket.
- Kerno uses Jet query builders with pgx transactions. Domain packages validate data; HTTP handlers coordinate authorization and services; PostgreSQL files are split by feature and operation. Keep transaction and access boundaries intact.
- The local Compose profile runs PostgreSQL, Keycloak and LiveKit. The NixOS production profile includes Caddy, Namecheap DDNS, Prometheus, Node Exporter and regado-agent. Cloudflare and Synapse directories are reserved integrations, not active production dependencies.
- Production Data1 mirrors data and metadata across two physical disks. NixOS has one separate root partition. Independent backups, content encryption and user/system escrow keys are not configured; never claim RAID1 is a backup or that current messaging is E2EE.

## Working rules

- Preserve unrelated work. Commit the requested scope; when the user explicitly asks to commit all accumulated changes, include all of them.
- Prefer cohesive helpers and shared packages over repeated application logic. Avoid one-line wrappers and fragmentation that makes ownership harder to follow.
- Add a short file-purpose comment before imports (inside the script block for Svelte). Omit “This file” and the final period. Preserve generated headers and required tool directives.
- Cancel obsolete requests and clear application-owned caches on teardown. Drain HTTP requests before closing pools; stop background workers before releasing their dependencies.
- Use SvelteKit navigation APIs for router-owned history. Keep URL, selected object and dialog state synchronized.
- Keep secrets, credentials, signing keys, dumps, user files and build output out of Git. Do not print ignored environment files.
- Run tests when the user requests verification. Headless fixtures and live tests are preferred over manual browser interaction. Report limitations honestly; historical audit scores are not current certification.
- Do not deploy, push or publish automatically during a refactor. Deployment instructions are operator workflows for an explicitly authorized release.

## Verification

See `docs/refactoring.md` for the current code map and verified refactor evidence. Main commands:

```sh
pnpm check:front
pnpm --filter @kaordo/contracts generate
pnpm test:pages
pnpm test:auth
pnpm test:dev
pnpm test:media
pnpm test:dependencies
pnpm test:ui-layout
pnpm test:product:ui
pnpm test:regado:ui
node --test scripts/ui-public.test.mjs
pnpm test:product:db # local application database running
pnpm test:auth:live # pnpm dev running
pnpm test:backup:live # both local database containers running
pnpm audit --audit-level=low
go test -race ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
go vet ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
go build ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
```
