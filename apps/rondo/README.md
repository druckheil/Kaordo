# Rondo

Independent SvelteKit application for community servers. Members can create or join public servers; the owner can create channels and invite accounts into public or private servers. Each channel has Ligo-backed messages and Nodo attachments, plus a local LiveKit room for voice, camera and screen sharing. The owner cannot leave a server yet, and owner transfer, moderation and E2EE are not implemented. Public voice ingress is configured separately in the NixOS profile and depends on reachable router ports.

The server rail, channel list and member list can be collapsed independently. The voice panel displays participant cameras and shared screens, supports panel and per-stream fullscreen, and offers screen capture presets from 360p/15 fps through 1080p/30 fps or original resolution. Actual capture quality depends on browser, selected source and available bandwidth. Interface sounds for joins, leaves and media controls can be muted in the voice panel. Browser permission is required for microphone, camera and screen capture.

`pnpm dev` starts the local databases, Keycloak, LiveKit, Kerno, Nodo and the static site. Open `/rondo/` after signing in. The production static build is assembled by `pnpm build:pages:production`. LiveKit API credentials are generated into the ignored `deploy/local/.env` file, and only Kerno signs room tokens after checking server membership.

## Code organization

`RondoApp` owns server/channel selection and coordinates queries/actions. `MemberPanel` renders membership; `rondo-state` holds selection/cache/layout helpers. Text composing and messages reuse `chat-ui`, Nodo media upload and shared immutable message-cache updates rather than a second chat implementation. Layout preference storage failure does not prevent panel toggling.

`VoiceStage` coordinates compact preview/fullscreen presentation and `VoiceTile` attaches individual LiveKit tracks. Room/track lifecycle and optional sounds belong to `voice-client`. Caches clear on teardown. `pnpm test:product:db` covers server ownership, private/public membership, join-history boundaries and channel access; `pnpm test:auth:live` adds real browser messages, voice and camera. The NixOS profile provides public voice configuration separately from the localhost development profile. See [refactor evidence](../../docs/refactoring.md).
