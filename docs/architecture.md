# Kaordo architecture boundary

Scope 0.0.1 establishes package boundaries. Working slices include local registration, TOTP, shared account identity, and Fluo social posting.

```mermaid
flowchart LR
  Browser --> Pages[Cloudflare Pages: static apps]
  Browser --> Tunnel[Cloudflare Tunnel: HTTPS and WebSocket ingress]
  Tunnel --> Kerno[Local Kerno: Go API]
  Tunnel --> Keycloak[Local Keycloak: identity]
  Tunnel --> Synapse[Local Synapse: Matrix messages]
  Tunnel --> LiveKit[Local LiveKit: call signaling]
  Browser --> Nodo[Local Nodo: tus upload and signed media]
  Browser --> LiveKit
  Kerno --> Postgres[Local PostgreSQL]
  Kerno --> Nodo
  Nodo --> Disks[Local media directory]
```

The browser apps are separately built from one pnpm workspace and assembled as one static Pages site. Shared TypeScript packages hold UI, OIDC integration, account access, typed API and pagination policy, media upload, contracts, cryptography, and cross-app links.

Kerno is a modular Go service for business data and authorization. It validates Keycloak access tokens, creates the local user record, and stores Fluo posts, comments, quotes, reactions, follows, saved-post relations and attachment metadata. Nodo is an independent Go service for authenticated resumable uploads and image/video processing. Kerno checks upload ownership before linking media to a post; accessible post responses receive short-lived signed Nodo links. The Go workspace keeps both binaries and the signing module independently buildable. Local Keycloak and PostgreSQL are defined in `deploy/local/compose.yaml`; Synapse, LiveKit and observability have documentation placeholders only and are not deployed by the local Compose stack.

Fluo uses TanStack Query and Virtual for its cursor-paginated feed, Tiptap for structured text, Uppy/Tus and Pica for upload, PhotoSwipe for images and Vidstack for video. Its feed supports Latest and Following; search, saved posts and the user's posts are separate views, with the latter shown on Profile. Notifications and Settings are navigation destinations without implemented product workflows. The remaining app scaffolds do not import Matrix or LiveKit. Each package declares the libraries its source uses, and the editor/media libraries load only in the views that need them.

All apps use the shared Tailwind CSS, shadcn-svelte/Rhea, Bits UI, and Lucide system through `@kaordo/ui`.

The root Pages build has paths `/`, `/login/`, `/register/`, `/ligo/`, `/fluo/`, `/rondo/`, and `/regado/`. Fluo's initial discovery order is reverse chronological with a following filter; it works from one account onward without training data. Nodo stores uploaded media in a local directory and processes it, but disk mirroring, private-at-rest encryption, independent backup storage, public ingress and production deployment are not configured.
