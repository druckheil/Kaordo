# Deployment modules

The repository contains two distinct profiles:

- [Local](local/README.md): Docker PostgreSQL/Keycloak/LiveKit, local Go processes and the combined static frontend. Development settings bind to localhost.
- [NixOS](nixos/README.md): systemd services, Caddy HTTPS, Namecheap DDNS, mirrored Data1 storage, Prometheus/Node Exporter and the restricted Regado agent.

The static production frontend uses `pnpm deploy:pages:production` as documented
in the NixOS deployment guide. Backend and database releases remain a separate
operator workflow.

[Keycloak](keycloak/README.md), [PostgreSQL](postgres/README.md), [LiveKit](livekit/README.md), [storage](storage/README.md) and [observability](observability/README.md) document their boundaries. Cloudflare and Synapse are reserved alternatives. Build artifacts and runtime secrets are ignored; a refactor does not authorize publishing a release or changing a live host.

Application migrations run in numeric order as the application role before Kerno starts. Database schema and generated Jet definitions must agree. See [the refactor review](../docs/refactoring.md) for verification commands and current ownership.
