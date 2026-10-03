# Cloudflare

Reserved for static Pages and Tunnel ingress. `pnpm build:pages` produces `dist/pages`, usable by a static host. The current NixOS profile serves the same artifact through Caddy and uses Namecheap dynamic DNS; it does not require Cloudflare.

No active Pages/Tunnel configuration is supplied here. A tunnel can carry HTTP/WebSocket signaling but is not a replacement for LiveKit's reachable WebRTC UDP/TURN media path. See [deployment profiles](../README.md).
