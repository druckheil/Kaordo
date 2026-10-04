# Kaordo architecture boundary

Scope 0.0.1 establishes package boundaries. Working slices include local registration, TOTP, shared account identity, Fluo social posting, Ligo messaging, Rondo communities and Regado administration.

```mermaid
flowchart LR
  Browser --> Site[Local static apps]
  Browser --> Kerno[Local Kerno: Go API]
  Browser --> Keycloak[Local Keycloak: identity]
  Browser --> Nodo[Local Nodo: tus upload and signed media]
  Browser --> LiveKit[Local LiveKit: channel voice and video]
  Kerno --> AppDB[Local application PostgreSQL]
  Keycloak --> IdentityDB[Local identity PostgreSQL]
  Kerno --> Nodo
  Nodo --> Disks[Local media directory]
```

The browser apps are separately built from one pnpm workspace and assembled as one static Pages site. Shared TypeScript packages hold UI, OIDC integration, account access, typed API and pagination policy, media upload, contracts, cryptography, and cross-app links.

Kerno is a modular Go service for business data and authorization. It validates Keycloak access tokens, creates the local user record, and stores Fluo posts, Ligo messages and Rondo metadata. Nodo is an independent Go service for authenticated resumable uploads, image/video processing, and generic files. Kerno checks upload ownership before linking an attachment; authorized responses receive short-lived signed Nodo links. The Go workspace keeps Kerno, Nodo, Regado Agent and the signing module independently buildable. Local Keycloak, PostgreSQL and LiveKit are defined in `deploy/local/compose.yaml`; Synapse and observability are not deployed by the local Compose stack.

Fluo uses TanStack Query and Virtual for its cursor-paginated feed, Tiptap for structured text, Uppy/Tus and Pica for upload, PhotoSwipe for images and Vidstack for video. Its feed supports Latest and Following; search, saved posts and the user's posts are separate views, with the latter shown on Profile. Notifications and Settings are navigation destinations without implemented product workflows.

Ligo uses the same identity and media boundaries. PostgreSQL stores direct, group, and personal conversations, membership, cursor-paginated message history, unread and delivery cursors, reactions, edits, deletion tombstones, and idempotent send IDs. A dedicated PostgreSQL LISTEN connection sends membership-scoped change hints over authenticated SSE; the browser reloads pages via TanStack Query and uses native scrolling with explicit history anchoring. Nodo accepts up to eight attachments per message, including arbitrary files served as downloads. The SvelteKit app uses shared shadcn-svelte/Rhea Message, Bubble, Attachment, Context Menu, Dropdown Menu, Dialog, Avatar, and Textarea components. Ligo has no end-to-end encryption or Matrix integration. Rondo stores server and channel metadata in PostgreSQL and reuses Ligo's message, membership, reaction and Nodo attachment pipeline for channel text. Server owners can invite members and create channels; public servers support self-join. Kerno signs a short-lived LiveKit token for an authenticated channel member. The browser uses `livekit-client` for voice, camera and screen sharing; video and audio tracks remain inside LiveKit rooms rather than Nodo storage. The local LiveKit profile has no public TURN/TLS or UDP ingress, and self-hosted LiveKit does not invalidate already issued tokens after removal. Each package declares the libraries its source uses, and editor/media libraries load only in the views that need them.

All apps use the shared Tailwind CSS, shadcn-svelte/Rhea, Bits UI, and Lucide system through `@kaordo/ui`.

Regado is absent from the public app directory and is available at `/regado/` to accounts with the current database `admin` role. Kerno checks that role and the disabled-account flag on every admin request. The dashboard uses shared STaSBLR components and uPlot for Prometheus history. A root Regado agent reads Btrfs, SMART and service journals over a group-protected Unix socket; fixed maintenance actions require an audited reason. User status and role changes are transactional. A 15-minute content access case writes an immutable notification to the target's Ligo Saved messages, audits reads and can be closed early. Existing plaintext data has no user-held encryption key or system escrow key.

The root Pages build has paths `/`, `/login/`, `/register/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. The development profile serves those files locally. The NixOS production deployment uses Caddy HTTPS at `kaordo.link` with Namecheap dynamic DNS; Cloudflare Pages and Tunnel are not used by that profile. Fluo's initial discovery order is reverse chronological with a following filter; it works from one account onward without training data. Nodo processes uploaded media in its configured directory. Production PostgreSQL, media, metrics, static releases and secrets are stored on Data1, a two-device Btrfs RAID1 filesystem. NixOS has one separate 64 GiB root partition. Private-content encryption and an independent backup destination remain unconfigured. Deployment details are in `deploy/nixos/README.md`.

## Refactored ownership

Apps compose feature-specific panels and dialogs; `api-client` owns typed requests and query policies, including Regado cancellation/cache keys. Ligo and Rondo share one `chat-ui` composer, message renderer and immutable cache helpers. Fluo's controller owns navigation/actions; separate feed, header, composer and detail components own their presentation. Post dialogs use SvelteKit shallow history APIs rather than mutating router state directly.

Go entry points load configuration and wire services. Kerno/Nodo drain active HTTP requests before closing database/worker dependencies. Nodo owns cancellation and teardown for processing/GC. PostgreSQL files separate feature reads, writes, membership, reactions and access cases while preserving their original transactional boundaries. Jet schemas and OpenAPI types remain generated contracts. See [current review and verification](refactoring.md).
