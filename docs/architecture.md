# Kaordo architecture boundary

Scope 0.0.1 establishes package boundaries. Working slices include local registration, TOTP, shared account identity, Fluo social posting, Ligo messaging, Rondo communities, Lingvo language learning and Regado administration.

```mermaid
flowchart LR
  Browser --> Site[Local Vite HMR proxy]
  Browser --> Kerno[Local Kerno: Go API]
  Browser --> Keycloak[Local Keycloak: identity]
  Browser --> Nodo[Local Nodo: tus upload and signed media]
  Browser --> LiveKit[Local LiveKit: channel voice and video]
  Kerno --> AppDB[Local application PostgreSQL]
  Keycloak --> IdentityDB[Local identity PostgreSQL]
  Kerno --> Nodo
  Nodo --> Disks[Local media directory]
```

The browser apps are independent SvelteKit projects in one pnpm workspace. Local development runs one Vite server per app behind a same-origin proxy, preserving auth and API origins while supporting HMR. Release builds are still assembled as one static Pages site. Shared TypeScript packages own UI, OIDC integration, account access, typed API and pagination policy, chat, media, voice, language learning, contracts and cross-app links. The crypto package is reserved; content encryption is not implemented.

Kerno is a modular Go service for business data and authorization. It validates Keycloak access tokens, creates the local user record, and stores Fluo posts/settings/notifications, Ligo messages, Rondo metadata, private Lingvo dictionaries/reviews and Regado access/audit records. Nodo is an independent Go service for authenticated resumable uploads, image/video processing, and generic files. Kerno checks upload ownership before linking an attachment; authorized responses receive short-lived signed Nodo links. The Go workspace keeps Kerno, Nodo, Regado Agent and the signing module independently buildable. Local Keycloak, PostgreSQL and LiveKit are defined in `deploy/local/compose.yaml`; Synapse and observability are not deployed by the local Compose stack.

Fluo uses TanStack Query and Virtual for its cursor-paginated feed, Tiptap for structured text, Uppy/Tus and Pica for upload, PhotoSwipe for images and Vidstack for video. Its feed supports Latest and Following; search, saved posts and the user's posts are separate views, with the latter shown on Profile. Activity notifications persist read state and apply an hourly cooldown to repeated actions. Settings offers per-event notification policies and account privacy through shared Rhea/Bits UI controls. Private accounts share posts only with accounts the author follows; individually private posts remain author-only. Hidden likes increase counts without identifying their actor through notifications.

Ligo uses the same identity and media boundaries. PostgreSQL stores direct, group, and personal conversations, membership, cursor-paginated message history, unread and delivery cursors, reactions, edits, deletion tombstones, and idempotent send IDs. A dedicated PostgreSQL LISTEN connection sends membership-scoped change hints over authenticated SSE; the browser reloads pages via TanStack Query and uses native scrolling with explicit history anchoring. Nodo accepts up to eight attachments per message, including arbitrary files served as downloads. The SvelteKit app uses shared shadcn-svelte/Rhea Message, Bubble, Attachment, Context Menu, Dropdown Menu, Dialog, Avatar, and Textarea components. Ligo has no end-to-end encryption or Matrix integration. Rondo stores server and channel metadata in PostgreSQL and reuses Ligo's message, membership, reaction and Nodo attachment pipeline for channel text. Server owners can invite members and create channels; public servers support self-join. Kerno signs a short-lived LiveKit token for an authenticated channel member. The browser uses `livekit-client` for voice, camera and screen sharing; video and audio tracks remain inside LiveKit rooms rather than Nodo storage. The local LiveKit profile has no public TURN/TLS or UDP ingress, and self-hosted LiveKit does not invalidate already issued tokens after removal. Each package declares the libraries its source uses, and editor/media libraries load only in the views that need them.

All apps use the shared STaSBRL stack (Svelte/SvelteKit, Tailwind CSS, shadcn-svelte, Bits UI, Rhea and Lucide) through `@kaordo/ui`. Its catalog provides seven scoped light/dark palettes with Deep Purple as the default. A shared root `ThemeProvider` uses `mode-watcher` for pre-hydration mode, persistence and tab synchronization; `ThemeToggle` lives in app headers, followed by the rightmost `AgordojLink`. The public Portal route `/agordoj/` composes a shared Rhea/Bits UI `ThemePicker` and requires no account request. The Keycloak palette is generated from the same CSS source, and identity entry URLs carry the selected appearance across origins before native forms persist it locally. Interactive login/registration uses Keycloak URL builders without a preceding passive SSO check; the entry route is replaced rather than retained as a second confirmation screen.

Regado is absent from the public app directory and is available at `/regado/` to accounts with the current database `admin` role. Kerno checks that role and the disabled-account flag on every admin request. The dashboard uses shared STaSBRL components and uPlot for Prometheus history. A root Regado agent reads Btrfs, SMART and service journals over a group-protected Unix socket; fixed maintenance actions require an audited reason. User status and role changes are transactional. A 15-minute content access case writes an immutable notification to the target's Ligo Saved messages, audits reads and can be closed early. Existing plaintext data has no user-held encryption key or system escrow key.

The root Pages build has paths `/`, `/login/`, `/register/`, `/agordoj/`, `/ligo/`, `/fluo/`, `/rondo/`, `/lingvo/`, and `/regado/`. The local development profile proxies each Vite server at those paths; production serves the static release. The NixOS production deployment uses Caddy HTTPS at `kaordo.link` with Namecheap dynamic DNS; Cloudflare Pages and Tunnel are not used by that profile. Fluo's initial discovery order is reverse chronological with a following filter; it works from one account onward without training data. Nodo processes uploaded media in its configured directory. Production PostgreSQL, media, metrics, static releases and secrets are stored on Data1, a two-device Btrfs RAID1 filesystem. NixOS has one separate 64 GiB root partition. Private-content encryption and an independent backup destination remain unconfigured. Deployment details are in `deploy/nixos/README.md`.

## Refactored ownership

Lingvo stores a separate private dictionary for each user/learning/native-language
triple. German words and phrases share validated card content and transactional
review history. Kerno uses official Go FSRS-6 for saved schedules; `lingvo-client`
uses pinned ts-fsrs for interval previews, plus browser speech, phrase comparison
and CSV. A shared reference fixture checks state/grade schedules, step translation
and the 36,500-day cap against both official libraries. Import identity separates
validated fields with NUL; migration 017 preserves retries for existing CSV cards.
Views load on demand and compose shared Rhea/Bits UI controls. See
[Lingvo's workflows and boundaries](../apps/lingvo/README.md).

Apps compose feature-specific panels and dialogs; `api-client` owns typed requests and query policies, including Regado cancellation/cache keys. `chat-client` owns Ligo/Rondo message queries, SSE synchronization, uploads and the idempotent outbox. `chat-ui` renders messages and owns composer/scroll interaction. Rondo separates community workflows, voice connection state and community dialogs from navigation/layout. Lingvo separates review/retry/undo state from card gestures and presentation; Regado separates administrative commands from dashboard queries and panels. Fluo publishing consumes document/file values rather than an editor instance. Post and conversation navigation use SvelteKit shallow history APIs.

Go entry points load configuration and wire services. Kerno's domain models/store interfaces are independent of PostgreSQL and incoming HTTP; outbound Nodo, agent/metrics and LiveKit adapters implement the consumer contracts. One router constructor accepts the configured modules, and feature handlers are grouped by operation. Kerno drains active HTTP requests, cancels and joins its PostgreSQL event listener, then closes the pool. Nodo's quota object owns usage maps and their lock; the upload server owns processing/GC lifecycle. Regado Agent separates its Unix socket/process entry point from `internal/agent` operations and telemetry. Browser state controllers cancel their requests before app-owned caches clear. PostgreSQL files retain the original transactions and access checks; Jet schemas and OpenAPI types remain generated contracts. See the [8 October architectural review](audits/architecture-2026-10-08.md), [refactor history](refactoring.md) and the dated [7 October quality audit](audits/iso-iec-25010-2023-2026-10-07.md).
