# Kaordo Nodo for Android

This app turns an Android device into an explicitly user-enabled personal storage node.

## Current capabilities

- Kaordo username/password login using the same client-side PBKDF2 proof as desktop.
- Session token encrypted with an Android Keystore AES-GCM key.
- Notification and battery-optimization setup, with Android 12 support.
- User-selected storage quota inside app-private storage; no broad storage permission.
- Persistent foreground service, partial wake lock, boot recovery, and status notification.
- Authenticated REST status/download endpoints.
- tus 1.0 core, creation, and termination endpoints with resumable streamed writes.
- Coordinator heartbeat with LAN candidates and the public address observed by Cloudflare.
- Management telemetry for Android version, battery, memory, storage, network and coordinator latency.
- Remotely synchronized upload/download, Wi-Fi-only and charging-only policies.
- On-demand 8 MB disk benchmark requested from the Nodo management panel.
- Short-lived, account-scoped access tickets verified through the coordinator; the desktop session token is never sent to a node.
- Independently allocated `public` and `private` spaces: both are readable by authenticated users, public accepts account-scoped writes, and private writes stay owner-only.
- Fluo post metadata stored as compact JSON beside its media on the selected Nodo.
- Direct resumable Fluo media upload and authenticated timeline/download/delete REST endpoints.
- Stable, signing-key-scoped Android device identity with a separate node slot, so reinstalling the same host reuses its canonical server record.

The node listens on TCP port `49321`. Direct endpoints require a short-lived access ticket. Existing legacy routes address the private space; explicit routes live under `/v1/spaces/public` and `/v1/spaces/private`. Fluo currently uses LAN candidates only; the observed public address is retained for a future encrypted traversal layer.

## Build

Open this directory in Android Studio, allow it to install Android SDK 36, and run the `app` configuration. From a shell with the Android SDK configured:

```sh
./gradlew test assembleDebug
```

The application supports Android 12+ (`minSdk 31`). Android 12 uses the regular foreground-service path, does not request the Android 13 notification permission, and never receives the Android 14+ `specialUse` service type at runtime.

## Network security boundary

The app exposes the direct HTTP/tus listener on a trusted LAN. Public NAT traversal is deliberately disabled for real user content until a later networking milestone adds pinned TLS or application-layer end-to-end encryption and relay fallback. Cloudflare acts only as an authenticated rendezvous and ticket verifier; post and media bytes never pass through it.
