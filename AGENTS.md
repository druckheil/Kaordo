# Kaordo development guide

Read this before changing the repository. Product UI and all user-facing copy must be in English.

## Baseline

Scope 0.0.1 starts from a new Git root. The previous 0.2 codebase and full history are archived at `/Users/druckheil/Projects/Archive/Kaordo-before-0.0.1`. This rebuild does not retain old wire formats, D1 schemas, Tauri commands, or release artifacts. Do not bring back old services merely for compatibility.

## Architecture

- Independent SvelteKit apps live in `apps/` and share browser code through `packages/`.
- `packages/ui` is the single source for Tailwind tokens and shadcn-svelte Rhea components. Bits UI provides component behavior and Lucide provides icons.
- `services/kerno` and `services/nodo` are independent Go modules in `go.work`. Kerno coordinates metadata and access; Nodo owns file bytes and tus uploads.
- Local infrastructure is planned around PostgreSQL, Keycloak, Matrix Synapse, and LiveKit. Cloudflare is reserved for static Pages and Tunnel ingress. Service deployment is not part of the initial scaffold.
- Private content encryption and administrator recovery are future product requirements. Do not describe the current scaffold as secure messaging or as deployed infrastructure.
- Shared APIs and identity mappings belong in contracts, not duplicated app code. UI components render and handle interaction; network, caching, retry, pagination, and cryptography belong in shared packages or services.

## Working rules

- Keep apps independently buildable and their dependencies scoped to the package that uses them.
- Do not add secrets, credentials, signing keys, database dumps, user files, or generated build output to Git.
- Use `pnpm build:pages` to assemble the static frontend artifact and `go build ./services/kerno/... ./services/nodo/...` for the service scaffolds.
- Do not deploy the scaffold or publish old release artifacts as a new product release.
- Preserve unrelated work in the current branch. Commit only the requested scope.
