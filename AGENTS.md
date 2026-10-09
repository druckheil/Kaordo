# Kaordo development guide

Product UI and all user-facing copy must be in English. Repository documentation is English; conversation with the user can use their language.

## Baseline and implemented scope

The rebuild started at scope 0.0.1 with a new Git root. The previous code and full history remain at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`. Do not restore old D1 schemas, wire formats, Tauri commands, or release artifacts for compatibility.

Implemented applications are Portal authentication/account entry, Fluo social posting with profiles, presence and activity settings, Ligo messaging, Rondo communities and LiveKit calls, Lingvo German vocabulary/phrase learning, Memoro daily tasks/journal, and Regado administration. Device-held content encryption and offline recovery are implemented in the current source; deploying them requires the one-time database reset described in `deploy/nixos/README.md`. Notifications outside Fluo, other account settings and Matrix integration remain incomplete or reserved. Describe actual capabilities and evidence, not the scaffold's original plans.

## Architecture

- Independent static SvelteKit apps live in `apps/`. Shared browser behavior lives in `packages/`; each package declares the dependencies it imports.
- `packages/ui` owns Tailwind tokens, shadcn-svelte Rhea components, Bits UI behavior and Lucide icons. Compose these components rather than reimplementing their interaction primitives.
- `packages/contracts/openapi.yaml` defines service routes and wire schemas. Generate TypeScript types; do not edit generated `openapi.d.ts` or PostgreSQL Jet tables/models manually.
- `auth` owns in-memory OIDC tokens; `account-ui` owns account gates, the presentation-only session preview and shared avatars with batched privacy-filtered presence. `api-client` owns requests, retry, TanStack Query options and shared message-cache updates. UI components own rendering and interaction.
- `chat-client` owns Ligo/Rondo conversation queries, SSE synchronization, the idempotent outbox and message mutations. `chat-ui` owns the shared composer, bubbles, grouping and native message scrolling. `media-client` owns cancellable uploads/image resizing; `media-ui` owns PhotoSwipe, Vidstack, Cropper.js and media geometry; `voice-client` owns LiveKit connections, participant projections and interface sounds.
- `editor-ui` owns the shared Tiptap editor and attachment drafts. `memoro-client` owns daily document validation, encrypted indexes and media. `crypto` owns device keys, signed content/media envelopes and offline recovery; `account-ui` owns approval/unlock presentation. Kerno stores sealed keys and ciphertext, never account private keys or recovery secrets. Fluo authors publish audience keys when public and seal them to followed accounts when private; profiles and access/identity/activity metadata remain clear. See `docs/encryption.md` before changing these boundaries.
- `lingvo-client` owns encrypted dictionaries, card presentation, phrase exercises, speech, CSV and authoritative lazy ts-fsrs scheduling. Kerno owns authorization and revision-checked opaque storage and serves only the static starter catalog.
- Four Go modules are in `go.work`: Kerno coordinates business metadata/access; Nodo owns tus uploads and bytes; mediaauth signs/verifies media links; regado-agent exposes fixed Linux operations through a protected Unix socket.
- Kerno owns the schema in `services/kerno/internal/postgres/migrations` (Goose, applied on startup, forward-only) and uses Jet query builders with pgx transactions. Domain packages validate data; HTTP handlers coordinate authorization and services; PostgreSQL files are split by feature and operation. Keep transaction and access boundaries intact.
- Kerno's `account` and `admin` packages own their models, errors and store contracts. HTTP depends on those contracts; PostgreSQL implements them and translates driver absence errors. `admin.SystemOperations` owns command validation, audit ordering and storage-maintenance coordination through consumer-owned ports. `nodoclient`, `regado` and `rondovoice` are outbound adapters. `cmd/kerno` is the composition root; `cmd/regado-agent` owns process/socket lifecycle and `internal/agent` owns protected host operations.
- The local Compose profile runs PostgreSQL, Keycloak and LiveKit. The NixOS production profile includes Caddy, Namecheap DDNS, Prometheus, Node Exporter and regado-agent. Matrix/Synapse and Cloudflare are not part of the system.
- Production Data1 mirrors data and metadata across two physical disks. NixOS has one separate root partition. Independent backup destinations remain operator configuration. Never claim RAID1 is a backup, that undeployed source protects existing production data, or that browser encryption defeats malicious client delivery. There are no administrator/system escrow keys or content-access cases.

## Working rules

- Preserve unrelated work. Commit the requested scope; when the user explicitly asks to commit all accumulated changes, include all of them.
- Prefer cohesive helpers and shared packages over repeated application logic. Avoid one-line wrappers and fragmentation that makes ownership harder to follow.
- Keep shared packages independent of app modules. Import implementation siblings directly rather than through their own public barrel. Controllers consume the operations they need; views own layout, focus and form interaction while feature state owns asynchronous workflows and disposal.
- Add a short file-purpose comment before imports (inside the script block for Svelte). Omit “This file” and the final period. Preserve generated headers and required tool directives.
- Cancel obsolete requests and clear application-owned caches on teardown. Drain HTTP requests before closing pools; stop background workers before releasing their dependencies.
- Use SvelteKit navigation APIs for router-owned history. Keep URL, selected object and dialog state synchronized.
- Keep secrets, credentials, signing keys, dumps, user files and build output out of Git. Do not print ignored environment files.
- Run tests when the user requests verification. Headless fixtures and live tests are preferred over manual browser interaction. Report limitations honestly; historical audit scores are not current certification.
- Do not deploy, push or publish automatically during a refactor. Deployment instructions are operator workflows for an explicitly authorized release.

## Verification

`docs/architecture.md` is the code map. Follow `docs/ci.md` for suite ownership, isolation, failure diagnosis and GitHub Actions rules. Main commands:

```sh
pnpm check:front
pnpm format:check
pnpm lint
pnpm knip
pnpm --filter @kaordo/contracts generate
pnpm test:unit
pnpm test:pages
pnpm test:ui
pnpm test:integration # static apps built; Docker and restic available; pnpm dev stopped
pnpm test:product:db # local application database running
pnpm test:auth:live # pnpm dev running
pnpm test:backup:live # both local database containers running
pnpm audit --audit-level=low
pnpm lint:go
pnpm test:go
```

New ESLint findings fail CI. Existing ones are recorded in `eslint-suppressions.json`; fix them rather than adding suppressions, then run `pnpm lint --prune-suppressions`. Temporary golangci-lint exclusions in `.golangci.yml` follow the same rule.

## CI changes

- Use Playwright Test for browser scenarios and its fixtures/assertions/lifecycle; keep Node tests for browser-independent code. Tests use English role/label selectors.
- Integration must use the built static app artifact and the complete live project. Never replace the full journey with an identity-only subset to make CI green.
- Diagnose the first failed action from logs/traces. Fix reloads, missing requests, unsettled state or application defects before adding waits. Do not weaken checks or add blanket retries.
- Keep the stable `checks` gate dependent on every validation layer, cancel obsolete runs, cache dependencies/compilation only, and pin external Actions/tools. Preserve ephemeral database/account/backup ownership and cleanup.
- Browser fixture traces are safe only with synthetic data. Disable credential-flow traces/screenshots and never upload environments, tokens, browser storage, database dumps or user media.
- Verify workflow edits with actionlint and a complete hosted run; record the exact commit and measured cold/warm durations in `docs/ci.md`.
