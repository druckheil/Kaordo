# Rondo

Independent SvelteKit application for community servers. Members can create or join public servers; the owner can create channels and invite accounts into public or private servers. Each channel has Ligo-backed messages and Nodo attachments, plus a local LiveKit room for voice, camera and screen sharing. The owner cannot leave a server yet, and owner transfer, moderation, E2EE, and public voice ingress are not implemented.

The server rail, channel list and member list can be collapsed independently. The voice panel displays participant cameras and shared screens, supports panel and per-stream fullscreen, and offers screen capture presets from 360p/15 fps through 1080p/30 fps or original resolution. Actual capture quality depends on browser, selected source and available bandwidth. Interface sounds for joins, leaves and media controls can be muted in the voice panel. Browser permission is required for microphone, camera and screen capture.

`pnpm dev` starts the local databases, Keycloak, LiveKit, Kerno, Nodo and the static site. Open `/rondo/` after signing in. The production static build is assembled by the repository root `build:pages` command. LiveKit API credentials are generated into the ignored `deploy/local/.env` file, and only Kerno signs room tokens after checking server membership.
