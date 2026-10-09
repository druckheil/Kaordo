# Architecture and design-pattern review — 8 October 2026

## Scope and method

Reviewed all six SvelteKit applications, thirteen shared browser packages, all
four Go modules, and the supporting build, local lifecycle and deployment code.
The baseline is commit `b693071b2f601d7fa803e7f5df5a17f70e099d5d` on
`scope-0.0.4`. This report describes the subsequent working-tree refactor.

The review traced state ownership, request and worker lifetimes, import
directions, transaction/access boundaries and external library integration.
It examined duplicated validation/workflows, branch-heavy functions, component
scripts and composition roots. Evidence includes source comparison, parser-based
import graphs, cognitive-complexity analysis, compilation and Go vet. Pattern
names describe concrete responsibilities; they do not require classes or a
framework.

Behavioural equivalence is an implementation objective, not a proven result of
compilation. Functional, database, live and browser suites were not run for this
request. No manual browser exploration was used. This is a structural review,
not an ISO certification or a numerical quality score.

## Implemented decisions

| Problem                                                                                                                                                                    | Pattern / approach                                                                     | Why it fits                                                                                                                                                                 | Changed implementation files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Complexity or coupling removed                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ligo conversation discovery mixed form state, debounced search, API mutations, cache invalidation and rendering; direct/group actions repeated busy/error/finally handling | Container/Presenter, typed Command values and explicit dependency injection            | One cohesive controller owns the complete dialog workflow. Two command variants share execution without a command registry or handler classes                               | [ConversationDialog.svelte](../../apps/ligo/src/lib/ConversationDialog.svelte), [conversation-dialog-state.svelte.ts](../../apps/ligo/src/lib/conversation-dialog-state.svelte.ts), [api-client/ligo.ts](../../packages/api-client/src/ligo.ts)                                                                                                                                                                                                                                                                                                                                                          | View script body 141 → 42 lines; two async execution paths become one; controller consumes three API operations. Member additions now accept the owner's AbortSignal                                                          |
| Rondo settings mixed device discovery, defaults, track/audio checks, event listeners and controls; two microphone booleans allowed contradictory combinations              | Container/Presenter and a small explicit State union                                   | One device controller owns resource cleanup and stale discovery results. Idle/starting/testing is sufficient; a general state-machine library adds no useful behaviour      | [RondoSettings.svelte](../../apps/rondo/src/lib/RondoSettings.svelte), [device-settings-state.svelte.ts](../../apps/rondo/src/lib/device-settings-state.svelte.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                       | View script body 168 → 27 lines; eleven local function declarations leave the view; microphone states reduced from four boolean combinations to three valid states                                                            |
| Fluo consumers depended on the full API; notification read completion was ignored after teardown but its request continued                                                 | Consumer-owned ports / interface segregation and explicit lifetime ownership           | TypeScript Pick expresses the actual dependency without an extra client wrapper. Existing OpenAPI fetch and TanStack Query retain transport/cache ownership                 | [post-actions.ts](../../apps/fluo/src/lib/post-actions.ts), [settings-state.svelte.ts](../../apps/fluo/src/lib/settings-state.svelte.ts), [notification-state.svelte.ts](../../apps/fluo/src/lib/notification-state.svelte.ts), [api-client/fluo.ts](../../packages/api-client/src/fluo.ts), [fluo-notifications.ts](../../packages/api-client/src/fluo-notifications.ts)                                                                                                                                                                                                                                | Action/settings/notification controllers consume four/two/four operations; notification query helpers consume one each. Read mutations receive a lifetime signal and discard completion after teardown                        |
| Regado HTTP command handling owned validation, storage preflight, host execution, Nodo coordination and audit sequencing; audit calls passed nine positional values        | Application Service, Command value, Ports & Adapters and explicit dependency injection | This is a real multi-adapter use case. HTTP keeps transport/access handling; the admin service owns operation order independently of HTTP and PostgreSQL                    | [admin/operations.go](../../services/kerno/internal/admin/operations.go), [system_service.go](../../services/kerno/internal/admin/system_service.go), [httpapi/admin.go](../../services/kerno/internal/httpapi/admin.go), [admin_system.go](../../services/kerno/internal/httpapi/admin_system.go), [admin_layout.go](../../services/kerno/internal/httpapi/admin_layout.go), [admin_cases.go](../../services/kerno/internal/httpapi/admin_cases.go), [admin_journal.go](../../services/kerno/internal/httpapi/admin_journal.go), [admin_users.go](../../services/kerno/internal/httpapi/admin_users.go) | HTTP action cognitive complexity 13 → 6 and system handler file 225 → 133 lines. Execution consumes one host-command method and one audit method. Audit helper arguments 9 → 5; shared reason/device validation has one owner |
| Fluo/Ligo attachment pipelines duplicated UUID/uniqueness, alt-text normalization and orphan-reference rules                                                               | Shared validation policy with feature-specific adapters                                | Identical request rules share a small per-request context. Media ownership/type lookups remain specific to Fluo or Ligo                                                     | [attachment_inputs.go](../../services/kerno/internal/httpapi/attachment_inputs.go), [fluo_media.go](../../services/kerno/internal/httpapi/fluo_media.go), [ligo_media.go](../../services/kerno/internal/httpapi/ligo_media.go)                                                                                                                                                                                                                                                                                                                                                                           | Two copies of normalization/reference validation become one. Per-attachment cognitive complexity 6 → 3 in both handlers; per-page validation 6 → 4                                                                            |
| Fluo IDs and Ligo conversation cursors repeated custom UUID regexes despite an existing direct UUID dependency                                                             | Reuse the mature library at the domain boundary                                        | google/uuid already provides validation. An explicit 36-character gate preserves the accepted wire format, including uppercase/zero UUIDs and rejection of braced/URN forms | [fluo/model.go](../../services/kerno/internal/fluo/model.go), [ligo/model.go](../../services/kerno/internal/ligo/model.go)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Two regex definitions/imports removed; no new dependency or forwarding validation framework                                                                                                                                   |

Extraction reduces the amount a view or HTTP controller must understand.
It does not make the underlying device or administrative workflow disappear.
For example, the new system service's Execute complexity is 11 and pure command
validation is 13, including its added allowlist guard. These responsibilities
now have separate owners and dependencies; a project-wide complexity reduction
is not inferred by adding up only the shortened controllers.

### Boundary and lifecycle preservation

- Dialog commands retain the direct/group/member payloads, errors and query keys.
  Search timers clear when the dialog closes; owned mutations abort on teardown.
- Rondo continues to use voice-client for browser device integration and checks.
  The controller removes device listeners and stops microphone/speaker resources
  on unmount; revision checks reject obsolete discovery results.
- Notification reads retain scoped TanStack mutation serialization, server read
  state and immutable cache updates.
- System commands retain availability/body checks and error/status mapping.
  The service preserves preflight → requested audit → agent action → applicable
  Nodo maintenance → outcome audit. Agent rejection never starts Nodo maintenance.
  The root agent still validates privileged operations independently.
- Attachment processing retains sequential validation/ownership lookup and the
  same errors. Fluo still restricts post media; Ligo retains generic files.
- SQL expressions, transaction locks, generated contracts, migrations, dependency
  versions and release/deployment behaviour have no changes.

## Application inventory

| Frontend module                     | Existing useful patterns / ownership                                                                          | Audit decision                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Portal](../../apps/portal/src)     | Route composition, account gate/presenter and shared auth/account facade                                      | Keep route-specific account entry and UI local. Session bootstrap already has a controller; an app-specific service would forward the same operations                                      |
| [Fluo](../../apps/fluo/src/lib)     | Feed/query container, post command helpers, settings/notification controllers, editor/publishing separation   | Narrow consumer ports and cancel notification read mutations. Retain local focus/editor/layout interaction and the small setting/publish variants                                          |
| [Ligo](../../apps/ligo/src/lib)     | Navigation container, shared chat facade, receipt controller, separate sidebar/dialog                         | Separate conversation discovery's presentation from form/search/command ownership; share its actual execution sequence                                                                     |
| [Rondo](../../apps/rondo/src/lib)   | Community controller/dialogs, voice controller, shared chat, separate stage/tile presentation                 | Separate device settings state/effects from rendering and model microphone phases explicitly. Keep navigation/layout in RondoApp                                                           |
| [Lingvo](../../apps/lingvo/src/lib) | Dictionary/view container, lazy feature views, review/undo/retry controller, form containers and FSRS adapter | Keep bounded card/dictionary/library forms as feature containers. Review request IDs, uncertain-save recovery and queue ownership are already separate from card presentation              |
| [Regado](../../apps/regado/src/lib) | Dashboard query container, command-confirmation controller, projection panels and cancellable layout previews | Keep the typed five-variant intent union and explicit execution. Panels consume projections; a dynamic command registry would weaken the visible allowlist without reducing responsibility |

Large component size alone does not justify a controller. RondoApp's remaining
composition surface owns navigation/layout, while its community, chat and voice
workflows already have independent owners. Conversely, the settings/dialog
scripts above contained several distinct side effects and repeated workflows,
so extraction removes real presentation coupling.

## Shared browser package inventory

| Package                                       | Existing pattern / external implementation                                                                      | Decision and rationale                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ui](../../packages/ui)                       | Rhea/shadcn component composition, Bits UI interaction primitives, Lucide, Tailwind variants and theme provider | Preserve library-owned focus, radio/menu/dialog behaviour. Application controllers must not replace those primitives                                |
| [contracts](../../packages/contracts)         | Generated OpenAPI boundary contracts and shared projections                                                     | Keep one wire schema; no hand-written repository or second DTO model                                                                                |
| [auth](../../packages/auth)                   | Keycloak Adapter/Facade, injected session fetch and SDK-managed token lifecycle                                 | Keep in-memory token ownership and explicit initialization. No additional identity container or custom OIDC implementation                          |
| [account-ui](../../packages/account-ui)       | Account controller with injected ports, cancellation/generation protection and account gate/presenter           | Already separates session state/effects from account UI. Presentation-only session preview remains nonauthorizing                                   |
| [api-client](../../packages/api-client)       | OpenAPI Facades, session fetch decorator, query-option factories and immutable cache policies                   | Tighten operation contracts and pass lifetime signals through existing fetch APIs. Keep wire access in the shared client                            |
| [chat-client](../../packages/chat-client)     | Shared conversation controller/facade, idempotent outbox, SSE observer and query ownership                      | Already removes Ligo/Rondo workflow duplication. Uploading/sending/failed states and stable request IDs do not need another event bus/state library |
| [chat-ui](../../packages/chat-ui)             | Shared presenters, composer, grouping and native scroll interaction                                             | Keep local DOM interaction here; network/server-state policy stays in chat-client                                                                   |
| [media-client](../../packages/media-client)   | Uppy/Tus upload facade, Pica resize adapter and narrow metadata port                                            | Reuse mature resumable upload/cancellation. Keep feature configuration around the library rather than create a custom uploader                      |
| [media-ui](../../packages/media-ui)           | PhotoSwipe/Vidstack/Embla adapters, media geometry and owned view lifecycle                                     | Keep rendering/lazy viewer cleanup separate from bytes and upload policy                                                                            |
| [voice-client](../../packages/voice-client)   | LiveKit facade, participant projections, device/sound adapters and capture-preset configuration                 | SDK owns room/tracks. Rondo settings now consumes these adapters through one feature controller; no second RTC state machine                        |
| [lingvo-client](../../packages/lingvo-client) | Official ts-fsrs preview adapter, PapaParse CSV, shared validated card input and browser speech adapter         | Keep FSRS authoritative on the server; use the same configuration/step mapping in previews. CSV/AI workflows reuse card validation                  |
| [links](../../packages/links)                 | Typed canonical URL functions                                                                                   | Pure helpers already have one owner. A URL factory class adds no useful responsibility                                                              |
| [crypto](../../packages/crypto)               | Reserved integration                                                                                            | No active implementation to refactor; no claim of messaging E2EE or key recovery                                                                    |

## Backend package inventory

The four Go modules contain nineteen authored packages. Generated Jet packages
are excluded from authored-code measurements and remain generator-owned.

| Module / package                                                          | Existing useful pattern                                                                                | Audit decision                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Kerno cmd/kerno](../../services/kerno/cmd/kerno)                         | Composition Root and explicit constructor injection; configuration/process lifecycle separation        | Keep ordinary Go wiring. No DI container, reflection or service locator                                                                                       |
| [Kerno account](../../services/kerno/internal/account)                    | Domain model, Store port and domain absence error                                                      | Existing interface boundary is sufficient; no forwarding service for individual reads                                                                         |
| [Kerno admin](../../services/kerno/internal/admin)                        | Domain projections, Store port and fixed command inputs                                                | Add SystemOperations for the multi-adapter command workflow, with narrow host/audit/maintenance ports                                                         |
| [Kerno fluo](../../services/kerno/internal/fluo)                          | Domain validation and separate post/settings/notification store contracts                              | Reuse UUID validation; retain domain rules and SQL transaction ownership for reactions, privacy and notifications                                             |
| [Kerno ligo](../../services/kerno/internal/ligo)                          | Messaging domain/store port, receipt/cursor models and idempotent send inputs                          | Reuse UUID validation for the cursor; preserve messaging and membership semantics                                                                             |
| [Kerno rondo](../../services/kerno/internal/rondo)                        | Community/channel domain and Store port                                                                | Ligo-backed channel conversation/member contracts are intentional domain reuse; separate duplicate message models would increase coupling                     |
| [Kerno lingvo](../../services/kerno/internal/lingvo)                      | Dictionary/card domain, Store port and official Go FSRS adapter                                        | Preserve scheduler configuration and review serialization; no custom scheduling strategy                                                                      |
| [Kerno httpapi](../../services/kerno/internal/httpapi)                    | chi transport controllers, middleware, consumer ports and response presenters                          | Delegate system execution; share pure attachment request rules. Keep request decoding, authorization and small status/error switches explicit                 |
| [Kerno postgres](../../services/kerno/internal/postgres)                  | Repository adapters with Jet/pgx and explicit transactional Unit of Work                               | Keep access, notification cooldowns, media claims and FSRS review locks in the transaction that enforces them. No generic repository or per-table inheritance |
| [Kerno identity](../../services/kerno/internal/identity)                  | go-oidc adapter and bounded issuer/backchannel HTTP transport                                          | Preserve SDK-owned identity verification and mapped failures; do not recreate OIDC                                                                            |
| [Kerno nodoclient](../../services/kerno/internal/nodoclient)              | Outbound media/maintenance HTTP adapter                                                                | Existing timeout/auth/response boundary is cohesive. Keep media-specific checks and bounded responses                                                         |
| [Kerno ligoevents](../../services/kerno/internal/ligoevents)              | PostgreSQL LISTEN/SSE Observer with a narrow membership port                                           | Existing hints, backpressure/reconnect and joined shutdown own event lifecycle. Do not add an in-process bus or replace authorization-aware reloads           |
| [Kerno regado](../../services/kerno/internal/regado)                      | Unix-socket system adapter and separate Prometheus history adapter                                     | Same destination does not make both protocols interchangeable. Keep their response/error/security policies explicit                                           |
| [Kerno rondovoice](../../services/kerno/internal/rondovoice)              | Official LiveKit token/removal adapter                                                                 | Keep membership authorization before issuance and SDK token construction; no hand-written JWT/call abstraction                                                |
| [Nodo cmd/nodo](../../services/nodo/cmd/nodo)                             | Composition Root and graceful process lifecycle                                                        | Explicit configuration/construction remains simpler than a container                                                                                          |
| [Nodo internal/upload](../../services/nodo/internal/upload)               | tusd StoreComposer factory, upload facade, processing functions and quota/resource owners              | Keep three concrete image/video/file processing branches and native tools. Quota mutex, ownership checks and processing/GC teardown remain cohesive           |
| [mediaauth](../../services/mediaauth)                                     | Pure signature/token adapter using standard HMAC/URL primitives                                        | Stateless package API is sufficient. A service/repository abstraction would only forward calls                                                                |
| [Regado Agent cmd](../../services/regado-agent/cmd/regado-agent)          | Composition Root, protected socket and drain lifecycle                                                 | Process concerns already separate from operations                                                                                                             |
| [Regado Agent internal/agent](../../services/regado-agent/internal/agent) | Injected command runner, fixed Command allowlist, native Disko/repart/Btrfs adapters and owned workers | Preserve privileged validation and explicit operation phases. Do not hide destructive-operation guards behind polymorphic handlers                            |

### Branches and integrations deliberately retained

- Fixed HTTP error/status switches and small setting/device/preset variants
  represent finite protocol choices. Tables are used for homogeneous configuration;
  strategy objects are justified only for genuinely interchangeable algorithms.
- The maximum authored Go function complexity remains 26:
  `validatedRepartSteps`. Its partition geometry, overlap, preservation and
  creation checks already use phase helpers. Turning those ordered guards into
  an object hierarchy would make host safety harder to follow. The separate
  `activateRoleArea` checks likewise protect discovery/identity/activation order.
- API validation and root-agent validation cross different trust boundaries.
  They remain independent even where individual checks resemble each other.
- Frontend view-specific API calls in bounded feature containers are allowed.
  The separation target is reusable presentation without embedded workflows,
  not a controller class for every form or a browser Repository over HTTP.
- Keycloak, Nodo, Prometheus, LiveKit and the protected agent each have their own
  protocol and lifecycle. Existing adapters share standard/library primitives;
  a universal external-service adapter would erase useful contracts.

## Supporting code

Build/local-session helpers, source fingerprints, migrations, deployment/SSH
support and restic operator workflows already separate orchestration from
shared process/HTTP helpers. Their explicit ordering, cleanup and rollback are
retained. No CI, release or infrastructure mutations accompany this review.
Cloudflare/Synapse remain reserved integrations. Production RAID1 is not an
independent backup, and this refactor does not configure a backup destination.

## Evidence

### Structural measurements

An import scan used the installed TypeScript, Svelte and PostCSS parsers,
workspace export maps and statically resolvable imports. It covered nineteen
workspaces plus repository scripts, with 372 source files after extraction.
Installed dependencies and generated builds were outside the import graph;
repository scripts include fixture/test import declarations. Type imports were
also inspected separately.

| Check                                                           | Result     |
| --------------------------------------------------------------- | ---------- |
| Workspace dependency ownership violations                       | 0          |
| Workspace cycles                                                | 0          |
| Runtime module cycles                                           | 0          |
| Module cycles including type imports                            | 0          |
| Domain imports of HTTP/PostgreSQL/pgx/Jet                       | 0          |
| Maximum authored Go function cognitive complexity, before/after | 26 / 26    |
| System HTTP action cognitive complexity, before/after           | 13 / 6     |
| Fluo/Ligo single attachment validation complexity, before/after | 6 / 3 each |
| Ligo dialog view total lines, before/after                      | 274 / 175  |
| Rondo settings view total lines, before/after                   | 259 / 118  |

Go cognitive complexity was measured with gocognit v1.2.1 against baseline
source and the refactored tree, excluding tests/generated Jet code. Script-body
line counts exclude script tags and leading/trailing blank lines. Lines are
composition-size measurements, not a quality score. Import analysis cannot
prove behaviour or discover a dependency constructed only at runtime.

Source review checked command/audit ordering, attachment error/lookup ordering,
microphone state transitions and UUID library format handling. Svelte AST
comparison preserved static text, element/attribute names and literal values in
both refactored views (165 Ligo records and 219 Rondo records); it is not a
rendered interaction assertion.

### Compilation and static checks

```sh
pnpm check:front
pnpm build:pages
go build ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
go vet ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./services/kerno/... ./services/nodo/... ./services/mediaauth/... ./services/regado-agent/...
git diff --check
```

All six applications passed Svelte/TypeScript checks with zero errors/warnings
and built as static applications. The four Go modules passed build/vet and the
Linux amd64 target build. Functional suites and hosted CI were not executed.
No new runtime dependency, OpenAPI/Jet edit, migration or lockfile change is
part of this refactor.

The existing Vite size warning for the lazily imported LiveKit SDK remains:
517.79 kB minified, 134.51 kB gzip. It is not a compilation failure; this review
does not present it as resolved performance evidence.

## Maintenance guidance

Use a new controller when multiple state/effect lifetimes mix with reusable
presentation; use a service when a cohesive use case coordinates several
adapters. Declare the operations at the consumer and wire them explicitly.
Reuse existing SDK/query/UI lifecycle primitives. Preserve transaction and
authorization ownership, and retain short explicit branches when they are
clearer than dispatch abstractions. Measure the responsibility removed from
each caller rather than counting pattern names or smaller files.
