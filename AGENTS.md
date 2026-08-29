# Kaordo development guide

This is the permanent project memory for future work. Read it before changing
the repository. The product UI and all user-facing copy are always written in
English, even when the request is written in another language.

## Current baseline and version vocabulary

- Kaordo 0.2 is released and tagged as `v0.2`; its release commit is
  `62a704b` and `main` also contains the post-release CI/release fixes. The
  completed follow-up scope is `scope-0.2.1`; active development now continues
  on `scope-0.2.2`. Keep compatibility with the existing 0.1.x wire/data
  formats until a protocol migration is explicitly planned.
- Scope 0.1.2 was the first completed fast-forward release (historical
  `main` commit `4a18465`); keep the completed scope-0.1.2 and scope-0.1.1
  branches for history. The current 0.2 release is tagged `v0.2` as noted
  above.
-  0.2.1 is the current Open Beta release/download/site version. Scopes 0.1.3,
  0.1.7, 0.1.10 and 0.2.1 are completed scopes; 0.2.2 is active development.
  Do not bump all manifests or release URLs merely because a
  scope branch changes; do that only when the requested release actually
  changes.
- Nodo development builds carry a short scope build suffix in the Android
  `versionName`, such as `0.1.3-1a` (the first build of scope 0.1.3). A
  release build uses only `0.1.3`; reset the build counter to `1a` when the
  next development scope starts. The Android UI and heartbeat telemetry must
  use the same generated `BuildConfig.VERSION_NAME`.
- Do not replace protocol and schema versions while renaming product versions:
  tus/1.0.0, workspace/document format version 1, dependency versions, and
  the applied Durable Objects migration tag v1.1-ligo-live are not product
  release numbers.
- The old veridimensio strings in Cloudflare resource names, package IDs,
  Android application ID, and compatibility routes are intentional. Rename
  them only as an explicit migration with a compatibility plan.

## Product and repository

Kaordo is a desktop-first, local/decentralized communication and knowledge
suite. The major product areas are Klaro (knowledge/editor), Ligo
(one-to-one messenger and file exchange), Rondo (spaces with text/voice/video
rooms), Fluo (social feed), Mi (profile), Nodo (hosted storage node), Regado
(admin), and Agordoj (settings).

- apps/kaordo-client is the complete Svelte 5 + Tauri 2 desktop client.
  Despite its historical editor-ui name, it is the whole desktop client.
- apps/api is the Cloudflare Worker coordinator. It uses D1 for compact
  relational metadata and Durable Objects for live Ligo coordination.
- apps/nodo-android is the Android Nodo host; Android 12 / API 31 is the
  minimum supported platform.
- apps/nodo-linux is the headless Ubuntu/Linux Nodo host. It is a standalone
  Rust CLI with the same direct HTTP/TUS wire paths, Worker ticket
  verification, durable payload layout, heartbeat/reconciliation,
  systemd-user mode, and HTTPS + SHA-256 self-update flow. It has no graphical
  UI or desktop-client dependency.
- apps/downloads is the Cloudflare Pages download site. Its Pages Functions
  serve release objects from the kaordo-releases R2 bucket.
- crates/ contains the shared Rust workspace, CLI, core, and SDK crates.
- packages/sdk-wasm contains the WASM package.
- Desktop Klaro files and local chat archives live under
  Documents/Kaordo (with per-chat files in the local archive layout).
- release/ is ignored build output. Historical folders such as
  release/v0.1.0 and release/v0.1.1 are not source and must not be committed.

Cloudflare currently retains compatibility resource names:

- Worker: veridimensio-api
- Worker origin: https://veridimensio-api.pshenychnyi-ld.workers.dev
- D1 database binding/name: veridimensio-db
- Pages project/domain: kaordo / https://kaordo.pages.dev
- R2 release bucket: kaordo-releases

Never read, print, commit, or expose secret.txt, key material, session tokens,
Cloudflare tokens, R2 credentials, TURN credentials, or Android signing
passwords. Cloudflare administrative credentials stay server-side and must
never be returned to a client.

## Architecture rules

- Runtime state belongs in Controllers and GState classes managed through
  Director/state managers. Network and platform I/O belongs in gateways and
  transports, not Svelte components.
- Keep components focused on rendering and user interaction. Put persistence,
  pagination, reconciliation, retries, caching, and cancellation in state,
  service, gateway, or transport layers.
- Treat gateway interfaces as cross-platform contracts. When a contract
  changes, update all of the following in the same change: domain types,
  gateway interface, Web gateway, Tauri gateway, Rust Tauri command and its
  return type, command registration in src-tauri/src/lib.rs, application
  fallbacks/mocks, and focused tests.
- TypeScript and Rust IPC response shapes must match exactly. Do not use
  Result<(), String> when the Worker returns JSON consumed by the frontend.
- Tauri invoke can reject with a plain string. Preserve non-empty string errors
  as well as Error.message; never hide a useful backend error behind a generic
  fallback such as Ligo is unavailable.
- Nodo payloads are local files. D1 stores routing, ownership, retention,
  quota, status, receipts, tombstones, and reconciliation metadata only; it is
  not the primary payload store.
- Applied D1 migrations are immutable. Add the next numbered migration
  (currently after 0025) and never rewrite a migration already applied
  remotely.
- Keep Cloudflare free-tier traffic small: avoid duplicate polling and
  database calls, use live signals with bounded fallback polling, paginate
  large collections, keep D1 rows compact, and never upload media through the
  Worker when a direct Nodo transfer is possible.
- Session revocation is event-driven: authenticated desktop and Nodo clients
  keep one authenticated Durable Object WebSocket, and password changes push a
  `session-revoked` event to every session except the one that made the change.
  Do not reintroduce a periodic `/api/auth/presence` poll; Nodo heartbeats are
  still required for node liveness and remain the fallback when the live channel
  is unavailable.
- Preserve existing APIs, persisted files, D1 schemas, Tauri IPC names, Nodo
  wire paths, and user-visible behavior unless the active task explicitly
  changes them.

## Data and service behavior to preserve

### Nodo and public storage

- Android Nodo runs a foreground service, exposes direct HTTP/TUS storage, and
  sends a heartbeat to the Worker. The app being stopped means offline; do not
  fake perpetual online status.
- Clients prefer LAN addresses and then the observed address returned by the
  Worker. The current Worker coordinates authentication, tickets, reservations,
  and reconciliation; it does not magically solve every NAT case. For hosts
  that cannot be reached directly (for example an IPv6-only Linux VPS from an
  IPv4-only desktop), the authenticated HTTPS `/api/nodes/:id/relay/v1/*`
  fallback streams the existing Nodo HTTP/TUS protocol without storing payload
  bytes in D1. Direct LAN/public routes remain preferred; relay uploads use
  bounded resumable chunks. Diagnose reachability separately from quota/status.
- Public storage is a global logical pool assembled from all eligible public
  spaces, not one duplicated copy of a physical disk in every service.
- A public candidate must be online, allow uploads/downloads as required, have
  positive public quota and free space, use a compatible Nodo version, and not
  be pending tombstone reconciliation. Each user has the existing 1 GB public
  allowance. Reservations are temporary and become committed only after the
  post/file is successfully written.
- Private and public quotas are separate. Heartbeats report usage for each
  space; a space cannot be reduced below stored or actively reserved bytes.
- Public posts/messages must create the corresponding D1 allocation and later
  release/tombstone it. Android cleanup and the next heartbeat reconcile
  partial files, deleted posts, expired reservations, and offline-node
  recovery.
- When the product version was renamed from 1.0/1.1 to 0.1/0.1.1, the source
  compatibility gates were updated from the old 0.13/0.14.1 line to accept
  0.1.x. A Worker deployment is required after such a change: otherwise a
  live Nodo reporting 0.1.0 is silently filtered from public services even
  when it has ample space. Always verify both the Worker deployment and the
  D1 heartbeat row when a public Nodo appears unavailable.

### Linux Nodo

- `kaordo-nodo login` uses the same PBKDF2 password proof as Android and keeps
  the session in an owner-readable (`0600`) XDG config file. Never print or
  commit that file. `logout` clears that local session without deleting
  payloads.
- `setup` asks only for the total quota; public/private space is assigned by
  the Kaordo client through the coordinator after heartbeat. The local node
  starts private-only until that allocation arrives. `run` is foreground
  diagnostics; `start` installs/enables a user-level systemd unit when
  available and otherwise uses a pid/log fallback.
- The Linux service binds TCP 49321 by default, stores payloads below
  `$XDG_DATA_HOME/kaordo/nodo`, and preserves `/v1/files`, `/files`,
  `/v1/spaces/{private,public}`, Fluo, Ligo, Rondo and TUS contracts.
- Self-update is HTTPS-only, streams to a temporary file, verifies the SHA-256
  listed by the manifest, atomically replaces the executable, and requires an
  explicit restart. Do not add unsigned arbitrary download URLs.

### Fluo

- The feed is global and sorted by the current simple publication-date
  algorithm; the selected Nodo is a publication destination, not a feed
  filter.
- Load post metadata/text first. Lazy-load images/GIFs; videos initially show
  an unloaded player and begin streaming only after user interaction.
- Keep backend pagination and do not download every attachment before
  rendering the feed. Metadata pages fill a render-ahead buffer independently
  from media transfer.
- Fluo uses the official TanStack Svelte virtualizer in the component that owns
  the scroll-element contract. Rows have stable post keys, real dynamic
  measurements, and an overscan of 50 posts in each direction. Keep this
  deterministic adapter; do not layer another virtualizer, manual spacer math,
  `content-visibility`, or timer-based scroll rendering on top of it.
- Preserve the Fluo scroll element's geometry across app-section changes with
  `visibility`, not `display:none`; otherwise the virtualizer learns a zero
  viewport and produces blank reverse-scroll frames. Compensate the
  virtualizer's scroll margin for CSS application scale and remeasure rows only
  when their logical width changes.
- `FluoGState` owns page/cache state, but remote media loading state is local to
  each `FluoMedia` component: resolving one attachment must never replace
  `FluoSnapshot.posts` or rerender the whole timeline. The shared media
  scheduler starts visible work first in bounded animation-frame batches, and
  immutable Nodo responses use native private HTTP caching, ETags, and byte
  ranges so remounted images/video do not transfer again.
- Media limits and public reservations are enforced by the existing gateway,
  Worker, and Nodo contracts; keep upload progress and cancellation behavior.

### Ligo

- Messages are durable in local archives whenever possible. Media/files are
  cached as local files; text is stored in the archive metadata format rather
  than as an endlessly rewritten ad-hoc file.
- Cloud/Nodo transit storage is bounded history. Public/private selection,
  per-user limits, receipts, tombstones, deletion propagation, and
  reconciliation must remain consistent on both devices and when either user
  is offline.
- Sending is optimistic: insert the pending message immediately with a
  transparent/pending state, allow composing the next message, then update
  delivery/read state from receipts. Do not serialize the composer behind the
  previous network request.
- Status semantics are exact: circle = only on the sender's storage; one check
  = on the recipient device but unread; two checks = read.
- On chat/tab changes, reuse stable local archive paths and attachment IDs.
  Do not turn already cached files into errors because a new object URL was
  revoked or a stale in-memory list was rebuilt.
- Chat pagination must preserve the previous scroll anchor. Reserve stable
  per-message layout height while media loads so late content does not make
  the scroll jump or make file cards overlap.
- Right-click deletion must remove local data, sender/recipient Nodo data,
  and queue deletion/tombstone work for offline peers.
- The previous .mov conversion experiment was reverted. Keep native media
  playback; only retain the macOS-specific fullscreen affordance where
  requested. Do not reintroduce a Windows conversion/preparation pipeline.

### Rondo and shared UI

- A Rondo space has rooms that are both text and voice contexts, a vertical
  space rail, room list, member list, settings, invite codes, and a
  primary-node/multi-node hierarchy.
- Public Rondo storage follows the existing one-space/1 GB per-user
  restriction. Do not treat a physical public disk as a unique global node
  instance.
- Settings for theme, app scale, text size, microphone, speakers, microphone
  loopback test, and camera are global preferences and must be applied by the
  voice layer. Device selection must use the actual MediaStream constraints
  and permission flow, not a display-only hardcoded label.
- Tauri application scale uses the same CSS scale path as the browser. Do not
  call native WebView `setZoom`: WKWebView page zoom discards its backing/tile
  cache and previously made Fluo performance depend randomly on Agordoj scale
  changes. The virtualizer explicitly converts visual offsets back to logical
  CSS coordinates.

## Windows/Tauri regression checklist

The bundled Tauri runtime differs from an IDE/browser run. Before handing off
any desktop network change, verify:

1. Production Tauri CSP permits Tauri IPC, development localhost, LAN Nodo
   http:, Worker https:, and live wss: in connect-src. Missing https:/wss:
   previously made Nodo connectivity appear unavailable.
2. ligo_create_delivery originally declared an empty Rust response while the
   Worker returned LigoStorageUpdate. Keep Rust, TypeScript gateway, and
   Worker JSON shapes identical.
3. Every new Tauri command is registered in src-tauri/src/lib.rs.
4. Tauri command argument names match camelCase invocation names.
5. Browser and Tauri gateways expose the same behavior and fallbacks.
6. String errors from Tauri remain actionable instead of becoming generic
   availability errors.
7. Do not add a video conversion step merely to make Windows appear
   compatible; use the native player path and verify the actual cached file.

Older Rider/static-analysis warnings are not automatic reasons for a rewrite:
use Svelte 5 event/property syntax that the current compiler accepts, prefer
bind:value for interactive controls, replace deprecated document.execCommand
only when a behavior-preserving alternative exists, and keep text selection
disabled outside editable text.

## Iteration and local build handoff

Work one requested feature at a time. Stop after that feature, describe the
result briefly, and immediately provide the affected local build without
waiting for another request.

- Desktop/frontend/Rust changed: build and provide Windows x64 NSIS.
- Android Nodo changed: build and provide the signed release APK.
- Linux Nodo changed: build the Ubuntu/Linux x86_64 release, immediately
  upload the versioned binary and checksum manifest to the `kaordo-releases`
  R2 bucket through Pages, and provide the `update --apply` command. This is
  mandatory for every Linux Nodo change; do not wait for a separate upload
  request.
- Multiple targets changed: provide every affected build and complete the
  required Linux R2 upload when Linux is among them.
- Do not build macOS during ordinary iteration; the user runs macOS through
  the IDE. Build it only when explicitly requested.
- Do not run the full test suite or extra packaging during quick iteration
  unless requested. The requested build must still finish successfully.
- For API-only changes, deploy the Worker when the change is meant for the live
  service; no desktop build is required unless client/Rust code also changed.
- Overwrite stable artifact names. Never create p2, fixed, timestamped, or
  other duplicate artifacts.
- For the active scope 0.2.2, release/scope-0.2.2 may contain at most:
  - Kaordo_scope-0.2.2_windows_x64-setup.exe
  - Kaordo-Nodo_scope-0.2.2_android.apk
  - Kaordo_scope-0.2.2_macos_universal.dmg
- Linux Nodo artifacts remain ignored build output, but the current Linux
  development binary and its manifest are always published to Pages/R2 after
  a Linux Nodo change so installed nodes can self-update immediately. Never
  commit the binary, manifest, or release directory.
- Historical release folders are left intact. release/ is ignored and must
  never be committed.

### Windows x64 NSIS

Run from apps/kaordo-client:

~~~sh
PATH=/opt/homebrew/opt/llvm/bin:/Users/druckheil/.cargo/bin:$PATH \
XWIN_CACHE_DIR=/Users/druckheil/Projects/Kaordo/target/xwin-cache \
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc \
  --bundles nsis --config '{"version":"0.2.2"}'
~~~

Copy/overwrite:

~~~text
release/scope-0.2.2/Kaordo_scope-0.2.2_windows_x64-setup.exe
~~~

Cross-linker PDB warnings and the expected unsigned-on-macOS installer warning
are not build failures. Require a zero exit status and a produced NSIS file.

### Android Nodo release APK

Use the existing release keystore and retrieve its password from macOS
Keychain without printing it. Run from apps/nodo-android:

~~~sh
set -e
SIGNING_SECRET=$(security find-generic-password -a kaordo -s io.kaordo.nodo.release-signing -w)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/Users/druckheil/Library/Android/sdk
export ANDROID_SDK_ROOT=/Users/druckheil/Library/Android/sdk
export KAORDO_ANDROID_KEYSTORE_PATH='/Users/druckheil/Library/Application Support/Kaordo/release-signing/kaordo-nodo-release.jks'
export KAORDO_ANDROID_KEYSTORE_PASSWORD="$SIGNING_SECRET"
export KAORDO_ANDROID_KEY_ALIAS=kaordo-nodo
export KAORDO_ANDROID_KEY_PASSWORD="$SIGNING_SECRET"
./gradlew :app:assembleRelease
unset SIGNING_SECRET KAORDO_ANDROID_KEYSTORE_PASSWORD KAORDO_ANDROID_KEY_PASSWORD
~~~

Copy/overwrite:

~~~text
release/scope-0.2.2/Kaordo-Nodo_scope-0.2.2_android.apk
~~~

Always use the same signing key so an APK updates the installed Nodo without
logging the user out. Do not print signing variables or inspect secret.txt.

## Checks and Cloudflare delivery

Use the repository scripts and the locally installed Wrangler. If a global
wrangler is unavailable, use apps/api/node_modules/.bin/wrangler or run
pnpm exec wrangler from apps/api.

Useful focused checks:

~~~sh
pnpm api:check
pnpm check
cargo check --workspace
git diff --check
git status --short
~~~

Do not build/package unrelated apps or run the full test suite unless the user
asks. Review the diff and generated-output boundaries before committing.

When an API change includes a new D1 migration, from apps/api:

1. Apply pending migrations remotely:
   pnpm exec wrangler d1 migrations apply veridimensio-db --remote
2. Deploy the Worker:
   pnpm run deploy
3. Build affected Windows and/or Android artifacts and overwrite their stable
   paths.

For API-only code or compatibility fixes, deploy the Worker after checks even
if no migration is needed. This is especially important after version-gate
changes: a source fix is not live until the Worker is deployed.

The Pages site is deployed from apps/downloads with the configured R2 binding.
Keep current Open Beta links and the legacy 0.1.0 fallback mapping consistent
when changing release names. Use Wrangler and repository configuration, never
ad-hoc credentials or hardcoded secrets.

Do not deploy unrelated services, rewrite remote D1 history, upload arbitrary
files, or expose administrative credentials.

## Git workflow

- Preserve user changes and unrelated dirty files. Never use destructive
  reset/checkout commands to discard them.
- Commit only the approved feature or requested project instruction change.
  Do not include build output, caches, IDE files, local databases, or secrets.
- Normal feature commits do not need a push unless requested.
- When the user says a scope is finished and asks to merge it into main,
  treat that as authorization to:
  1. verify a clean tree and inspect the final diff;
  2. fast-forward merge the scope branch into local main;
  3. push main to origin/main;
  4. create and check out the next scope-X branch from the pushed main.
- Keep the completed scope branch for history. Do not delete branches, rewrite
  history, create release tags, or force-push unless explicitly requested.
- After a merge/push, report the commit, remote status, active next branch,
  and whether the tree is clean.
