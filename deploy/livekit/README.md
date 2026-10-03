# LiveKit

Rondo uses the self-hosted LiveKit SFU through `packages/voice-client`. Kerno checks channel membership before signing a short-lived join token; credentials never enter the browser build. Ligo-backed text messages and Nodo files remain separate from live room tracks.

The [local Compose profile](../local/README.md) configures signaling on 7880, RTC TCP on 7881 and UDP on 7882 for local clients. The [NixOS profile](../nixos/README.md) adds HTTPS signaling through Caddy and TURN, with router port shares documented there. Capture presets request resolution/frame rate; browser/source/bandwidth determine actual output.

Camera/screen tracks attach and detach through LiveKit. Fullscreen state follows the browser API and `fullscreenchange`. Already issued self-hosted join tokens are not immediately invalidated by database role changes; membership removal prevents new issuance and attempts participant disconnection. Current calls are not E2EE.
