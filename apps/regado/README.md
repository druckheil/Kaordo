# Regado

Independent SvelteKit administration app at `/regado/`. It is intentionally absent
from the public app directory. The initial HTML is static; every Regado API
request checks a current Keycloak access token against the database admin role.
Hiding the route is not an access control.

The dashboard uses `@kaordo/ui` components, the shared API client, and uPlot
for Prometheus history. Kerno provides account and audit data from PostgreSQL,
reads Prometheus on loopback, and talks to `regado-agent` over a Unix socket.
Each snapshot discovers physical disks from the host. A separate NixOS section
identifies the root partition and its physical disk, OS version, kernel, usage,
and compressed RAM swap. Disk cards include partitions, unallocated regions,
mount points, pool membership, capacity and health. Physical hardware and pool
capacity include replicas; usable capacity counts unique data after mirroring.
For two equal RAID1 members, roughly half the physical pool space is usable.

File copies offers two explained actions: **Check copies** runs a read-only,
rate-limited checksum scan, inventories regular files without following links
or crossing other filesystems, and checks expired Nodo artifacts against Kerno
references. **Repair and clean up** restores missing mirror profiles without
reducing higher redundancy, runs a repairing checksum scan, and rechecks
references and retention before removing expired unused uploads. Fresh,
referenced, unknown, and surviving files are retained. All members must be
online on distinct physical disks for repair.

Percentages count regular files and distinguish duplicated, single-copy,
surplus, and unverified placement. Uniform redundant profiles on online
distinct disks establish copy placement for the whole inventory; mixed or
unknown placement stays unverified. A missing replica is never surplus.
Checksum verification covers checksummed data, not NOCOW file contents.
Reports show their check timestamp and remain in service memory; restart
requires another check. They are not continuous per-file integrity monitoring.
Jobs continue after page navigation and poll every two seconds while active.

Storage uses the hierarchy **Host → physical device → partition → role**.
Device connection/transport, model, serial and WWN remain independent of roles.
System and Storage are partition roles, not fixed kinds of disks. GPT alignment
slack and boot metadata appear in a collapsed detail; useful free areas remain
allocatable. Help uses shared Rhea/Bits Popovers so it works with touch and a
keyboard, while long explanations stay outside the main layout.

**Manage partitions** sets desired sizes, previews the native plan and exports a
readable Disko declaration. Storage 100%, System 100% and combined layouts are
available on empty devices after boot/GPT reservations. Apply requires an exact
device-path confirmation and an audited reason. Disko handles initial creation;
systemd-repart adds areas or grows Btrfs partitions without moving existing data.
Existing System resizing, shrink/removal or unmanaged contents are explicitly
blocked for online application and need a separate migration/installation.
Prepared System data volumes are mounted by UUID. Existing production databases
and application state still live in the mirrored pool; adding a System volume
does not relocate them or install another NixOS. The current UI discovers one
connected host; remote NAS inventories need a connected agent or backend.

Progress shows measured bytes, Btrfs chunks, files or completed workflow steps
for the current phase. Unknown totals show a spinner and observed count. A
percentage is never inferred from elapsed time. Layout/copy operations share a
server-side serialization boundary and the UI disables conflicting actions.
Interrupted prepared Storage areas can be reviewed and activated safely.

Performance history includes CPU, memory, load, network, disk reads/writes and
aggregate filesystem utilization. The root agent accepts fixed system queries,
allowlisted service restarts, background Btrfs checks/repairs, and reviewed declarative partition changes. It does not execute caller-provided commands.

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

The production static build is assembled by `pnpm build:pages:production`.
`pnpm test:regado:ui` checks the dashboard in headless Chromium with fixture
identity and API responses: all sections, charts, role and access dialogs,
320px reflow, and automated light/dark accessibility. Backend authorization
and database effects are covered separately by Go and PostgreSQL tests.

## Code organization

`RegadoDashboard` coordinates independent TanStack Query resources and mutations; feature panels render overview, storage, users, system and audit. Account actions and intent/access dialogs are separate components. Typed API/query options live in `api-client`; log/user/case parameters belong to cache keys and reads accept cancellation signals. A stale request cannot overwrite another tab or filter. Private case caches are removed on closure and all app caches clear on teardown. Polling applies to relevant operational views, not every tab indiscriminately.

`pnpm test:regado:ui` also checks stale-request isolation and one content-read request per selected access case. `pnpm test:product:db` verifies authorization, audit, notifications and transactional role changes. See [refactor evidence](../../docs/refactoring.md).
