# Kaordo voice client

Shared LiveKit room/track lifecycle for Rondo. The entry point connects/disconnects, controls microphone/camera/screen capture and reports participant state. The separate `sounds` subpath supplies optional local interface sounds after a user gesture.

Kerno authorizes channel membership and supplies the short-lived room token. Browser views attach/detach tracks using LiveKit and observe native fullscreen changes. Presets request capture resolution/frame rate; they cannot override browser/source/network limits. Credentials stay on the server and live tracks are not uploaded to Nodo. Calls are not E2EE.

The live journey checks room joining and synthetic camera controls. Real devices, remote multi-party quality and external TURN paths require separate validation. See [Rondo](../../apps/rondo/README.md) and [refactor evidence](../../docs/refactoring.md).
