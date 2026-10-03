# Regado

Independent SvelteKit administration app at `/regado/`. It is intentionally absent
from the public app directory. The initial HTML is static; every Regado API
request checks a current Keycloak access token against the database admin role.
Hiding the route is not an access control.

The dashboard uses `@kaordo/ui` components, the shared API client, and uPlot
for Prometheus history. Kerno provides account and audit data from PostgreSQL,
reads Prometheus on loopback, and talks to `regado-agent` over a Unix socket.
Storage includes filesystem usage, photo/video/file counts, Btrfs profile and
scrub results, and cached SMART status, temperature, power-on hours and sector
counters from smartmontools. Performance history includes CPU, memory, load,
network, disk reads/writes and Data1 utilization. Metrics are stored on Data1.
The root agent accepts only fixed system queries and four fixed maintenance
actions. It does not execute caller-provided commands.

Account content access requires a written reason and opens a 15-minute case.
Opening a case adds an immutable notification to the target's Ligo Saved
messages. Each content page read is audited before it is served. Media links
expire after one minute. The current product stores post and message content
without end-to-end encryption. No user recovery key or system decryption key
exists, so this workflow must not be described as key recovery. Introducing
user-held encryption and system escrow requires a separate migration of
existing content and a new key lifecycle.

Users can be disabled or enabled and granted or denied the administrator role,
with a recorded reason. Self role changes and disabling other administrators
are rejected. Role changes are serialized to prevent concurrent revocations
from removing every administrator. Closing an access case expires it on the
server; previously signed media links remain valid for at most one minute.
Service logs support service/priority/text filters and a JSON snapshot download.

The production static build is assembled by `pnpm build:pages`.
`pnpm test:regado:ui` checks the dashboard in headless Chromium with fixture
identity and API responses: all sections, charts, role and access dialogs,
320px reflow, and automated light/dark accessibility. Backend authorization
and database effects are covered separately by Go and PostgreSQL tests.
