# Regado agent

Independent Linux system monitor and restricted maintenance service. Build with
`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./cmd/regado-agent`.

The agent runs as root and accepts local HTTP over the group-protected Unix
socket `/run/regado-agent/agent.sock`. Kerno checks the current database admin
role and writes an audit record before requesting privileged actions. The
agent has no TCP listener and never executes caller-supplied commands.

Queries use lsblk, read-only parted layout discovery, `/proc/swaps`, Btrfs,
smartmontools and systemd's journal. `/etc/os-release` identifies the OS version.
Only physical block devices are returned as disks; zram is represented as
OS memory swap. SMART JSON is cached for five minutes; low-power devices return a
standby status. Fixed service actions, background copy checks/repairs and
reviewed declarative role allocations are supported. Device identity is a WWN
or stable serial; ambiguous identities, active swap and unmanaged volumes
require operator review.

`POST /storage/plan` accepts a device identity, desired System/Storage bytes and
an existing pool mount. It returns an exportable Disko declaration, native dry-run
steps, capability constraints and a geometry/pool fingerprint. `POST /storage/apply`
requires that fingerprint and exact device-path confirmation. Kerno audits the
written reason first. Accepted jobs continue independently of the HTTP request.

Disko initializes only genuinely blank devices, using `--mode format` after a
compile-only dry run. Per-device PARTUUIDs prevent identical role labels from
selecting another disk. BIOS and UEFI boot metadata are generated from host
firmware mode. Existing GPT layouts use systemd-repart definitions in partition
number order, preserving every existing type, start and size. Only Btrfs Storage
can grow online. Shrink/removal/movement or existing System resizing requires
an offline migration; the agent never invokes Disko's destroy mode.

New System ext4 volumes are mounted by filesystem UUID under
`/var/lib/kaordo-volumes` through the host systemd manager. A startup oneshot
remounts prepared volumes. This prepares storage; it does not install another
NixOS or migrate PostgreSQL/Keycloak/Redis. New raw Storage partitions join the
selected mounted Btrfs pool without force. Prepared, unformatted Storage areas
can be reviewed and activated after an interrupted job without rewriting their
partition table. Btrfs provides membership, filesystem growth and mirror repair.

Approval workspaces in `/var/lib/regado-agent/layout-*` retain the generated
definitions, request and original partition table. A second identity/geometry
check runs after preparation and immediately before mutation. Changes are never
applied implicitly by a NixOS rebuild. The NixOS module pins tools to its package
set and provides a private writable temporary directory for Nix compilation.

`check-storage` validates a mounted data pool, starts a background read-only
`btrfs scrub` capped at 64 MiB/s per device, and counts regular files on that
filesystem. `repair-storage` requires every member online on a separate disk,
converts nonredundant block groups to RAID1 with profile filters, and runs a
repairing scrub. RAID1C3/RAID1C4/RAID10 placement is preserved. Kernel operations
retain Btrfs consistency; insufficient workspace or unrepairable corruption
is reported rather than hidden. The agent never deletes application files.

The inventory excludes symlinks and other mounted filesystems. Placement is
classified conservatively from uniform whole-pool profiles and physical member
identity; mixed/unknown profiles remain unverified. Scrub results include every
member's status and errors. Checks do not validate NOCOW data contents. Reports
are timestamped in memory, and privileged jobs are serialized with onboarding.
Request cancellation does not cancel an accepted job; shutdown stops workers
after HTTP requests drain. The sandbox permits `/var/lib/btrfs` for scrub state.

## Code organization

`main.go` owns the Unix listener/server and worker lifetime. `api.go` defines fixed routes, service allowlists, mount validation and handlers; `command.go` bounds subprocess output and execution; `snapshot.go` reads host usage, physical devices, swap, mounted volumes and lifecycle state; `layout.go` discovers free regions and physical capacity; `filesystem.go` parses Btrfs profiles, membership and scrub status; `replication.go` owns detached copy checks and repairs; `partition_plan.go` generates declarations and validates native previews; `partition_apply.go` serializes/revalidates layout jobs and activates volumes; `partition_api.go` validates requests; `progress.go` polls measured tool counters; `storage.go` owns shared device/path guards; `smart.go` parses and caches device health without treating missing evidence as healthy. Filename-purpose comments appear before imports.

From the repository root run `go test -race ./services/regado-agent/...` and `go build ./services/regado-agent/...`. Linux commands require the NixOS profile; unit tests inject command responses and cover parsing/failures. See [refactor evidence](../../docs/refactoring.md).

## Native-tool verification

`deploy/storage/test-layout-tools.sh` runs on NixOS as root with the agent's
`cmd/regado-agent/testdata/storage-layout-bios.nix` fixture. It only creates a
temporary loop image. It tests Disko compilation/formatting, host-systemd
mounting, and systemd-repart growth under the agent sandbox while preserving
System data, UUIDs and partition starts. It does not use a physical disk.
