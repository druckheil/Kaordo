# Kaordo development guide

## Product and repository

Kaordo is a desktop-first, local/decentralized communication and knowledge suite. The product UI is always written in English.

- `apps/kaordo-client` is the complete Svelte 5 + Tauri 2 desktop client. Despite its history as `editor-ui`, it is not only the Klaro editor.
- `apps/api` is the Cloudflare Worker coordinator. It uses D1 for compact relational metadata and Durable Objects for live coordination.
- `apps/nodo-android` is the Android Nodo host. Its minimum supported platform is Android 12 (API 31).
- `crates/` contains shared Rust workspace, CLI, core, and SDK code.
- Desktop Klaro files live under `Documents/Kaordo`.
- Clients exchange payloads directly with Nodo whenever possible. Cloudflare authenticates, routes, coordinates, and stores compact metadata; it must not become the primary payload store.

Never read, print, commit, or expose `secret.txt`, key material, session tokens, Cloudflare tokens, or Android signing passwords. Cloudflare administrative credentials stay server-side and must never be returned to a client.

## Architecture rules

- Runtime state belongs in Controllers and `GState` classes managed through `Director`/state managers. Network and platform I/O belongs in gateways and transports, not Svelte components.
- Treat gateway interfaces as cross-platform contracts. When a contract changes, update all of the following in the same change: domain types, gateway interface, Web gateway, Tauri gateway, Rust Tauri command and its return type, command registration in `src-tauri/src/lib.rs`, application fallbacks/mocks, and focused tests.
- TypeScript and Rust IPC response shapes must match exactly. Do not use `Result<(), String>` when the Worker returns JSON that the frontend consumes.
- Tauri `invoke` can reject with a plain string. User-facing error conversion must preserve non-empty string errors as well as `Error.message`.
- Nodo payloads are local files. D1 holds routing, ownership, retention, quota, and reconciliation metadata only.
- Applied D1 migrations are immutable. Add the next numbered migration; never rewrite a migration already applied remotely.
- Keep Cloudflare free-tier traffic small: avoid duplicate polling and database calls, use live signals with bounded fallback polling, paginate large collections, and keep D1 rows compact.
- Preserve existing APIs, persisted files, D1 schemas, Tauri IPC names, Nodo wire paths, and user-visible behavior unless the active task explicitly changes them.

## Windows/Tauri regression checklist

Two Windows-only failures have already escaped because the bundled Tauri runtime differs from an IDE/browser run:

1. The production Tauri CSP is enforced. Missing `https:` and `wss:` in `connect-src` blocked Worker/live control traffic and made Nodo connectivity appear unavailable. Preserve support for Tauri IPC, development localhost, LAN Nodo `http:`, Worker `https:`, and live `wss:` connections in `tauri.conf.json`.
2. `ligo_create_delivery` originally declared an empty Rust response while the Worker returned `LigoStorageUpdate`. The successful response failed deserialization, and the plain Tauri rejection was then hidden behind `Ligo is unavailable`. Keep the Rust command response, TypeScript gateway return type, and Worker JSON contract identical, and preserve string errors.

Before handing off any desktop network change, verify:

- CSP permits the required LAN and remote schemes;
- every new Tauri command is registered;
- command argument names match Tauri camelCase invocation arguments;
- Rust and TypeScript return shapes match the Worker response;
- browser and Tauri gateways expose the same behavior;
- errors remain actionable instead of becoming a generic fallback.

## Iteration and local build handoff

Work one requested feature at a time. Stop after it, describe the result briefly, and immediately provide the affected local build without waiting for another request.

- Desktop/frontend/Rust changed: build and provide Windows x64 NSIS.
- Android Nodo changed: build and provide the signed release APK.
- Both changed: provide both files.
- Do not build macOS during ordinary iteration; the user runs macOS from the IDE. Build it only when explicitly requested.
- Do not run the full test suite or extra packaging during quick iteration unless requested. The requested build itself must still finish successfully.
- Overwrite the stable artifact names. Never create `p2`, `fixed`, timestamped, or similar duplicates.
- `release/scope-0.1.1` may contain at most these three current artifacts:
  - `Kaordo_scope-0.1.1_windows_x64-setup.exe`
  - `Kaordo-Nodo_scope-0.1.1_android.apk`
  - `Kaordo_scope-0.1.1_macos_universal.dmg`
- `release/` is ignored and must never be committed.

### Windows x64 NSIS

Run from `apps/kaordo-client`:

```sh
PATH=/opt/homebrew/opt/llvm/bin:/Users/druckheil/.cargo/bin:$PATH \
XWIN_CACHE_DIR=/Users/druckheil/Projects/Kaordo/target/xwin-cache \
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc \
  --bundles nsis --config '{"version":"0.1.1"}'
```

Then overwrite:

```text
release/scope-0.1.1/Kaordo_scope-0.1.1_windows_x64-setup.exe
```

Cross-linker PDB warnings and the expected unsigned-on-macOS installer warning are not build failures; require a zero exit status and a produced NSIS file.

### Android Nodo release APK

Use the existing release keystore and retrieve its password from macOS Keychain without printing it. Run from `apps/nodo-android`:

```sh
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
```

Then overwrite:

```text
release/scope-0.1.1/Kaordo-Nodo_scope-0.1.1_android.apk
```

Always use the same signing key so an APK can update the installed Nodo without logging the user out.

## Cloudflare and delivery order

When an API change includes a new D1 migration, the order is:

1. Apply pending migrations remotely from `apps/api` with `pnpm exec wrangler d1 migrations apply veridimensio-db --remote`.
2. Deploy the Worker with the existing project deploy script (`pnpm run deploy`).
3. Build the affected Windows and/or Android artifacts and overwrite the stable local paths.

Use Wrangler and the repository configuration rather than ad-hoc Cloudflare API calls. Never push, publish releases, upload artifacts, rewrite Git history, or deploy unrelated services unless the user explicitly requests it.

## Git discipline

- Preserve user changes and unrelated dirty files.
- Commit only the approved feature after the user accepts it.
- Do not include build output, caches, IDE files, local databases, or secrets.
- Do not push unless explicitly requested.
- Keep the current working branch unless the user asks to change it.
