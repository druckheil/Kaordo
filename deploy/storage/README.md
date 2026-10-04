# Storage

Nodo owns upload bytes, processing outputs and local metadata. Kerno owns authorized references and retirement: a file may be shared by multiple posts/messages while a live reference remains. After its last reference is removed the upload ID is retired and Nodo purges it after confirming no active references. Unreferenced uploads age out after 24 hours; unavailable reference checks preserve bytes for a later pass.

The [NixOS profile](../nixos/README.md) stores PostgreSQL, media, releases, metrics and secrets on Data1, a Btrfs RAID1 filesystem spanning two physical disks with data/metadata mirroring and periodic scrub. NixOS is a separate 64 GiB root on one disk. Regado reports filesystem profiles, scrub and SMART evidence; it does not count unavailable checks as healthy or prove individual copies byte by byte.

Regado separately reports physical capacity (including replicas), usable unique
capacity, and unallocated regions on each disk. Its NixOS section links the root
partition to the physical device; zram is compressed RAM, not a third disk.
File-copy checks inventory regular data-pool files and use uniform redundant
profiles plus online physical membership as evidence of copy placement.
Mixed profiles remain unverified rather than yielding guessed per-file ratios.
The last-check percentages distinguish duplicated, single-copy, surplus and
unverified files. Surplus means expired Nodo upload artifacts with no live
references, never a surviving replica of missing data. Repair converts only
nonredundant profiles, runs a repairing scrub, and cleans these confirmed
artifacts. Missing disks must be reconnected or replaced first.

See the upstream [scrub](https://btrfs.readthedocs.io/en/latest/btrfs-scrub.html)
and [balance](https://btrfs.readthedocs.io/en/latest/btrfs-balance.html) contracts.
Scrub checks data/metadata with checksums and cannot validate NOCOW contents.
Reports are in memory and are not a continuous or independent backup guarantee.

Local development uses the ignored `deploy/local/media` directory and Docker database volumes, without disk mirroring. [Local restic commands](../local/README.md#encrypted-local-backups) back up both databases and media and verify disposable restores. An independent destination, recoverable key copy and schedule still require operator configuration. RAID1 is not an independent backup; dumps and media are not an atomic snapshot. Product content encryption is not implemented.

## Declarative device management

The model is Host → physical device → partition → System/Storage role. Hardware
identity and connection remain separate; there are no System/Storage/Mixed disk
types. Regado discovers physical devices and real free areas, puts BIOS/EFI/GPT
metadata in a collapsed detail, and previews desired role allocations.

| Tool | Responsibility and selection |
| --- | --- |
| [Disko](https://github.com/nix-community/disko) | Declarative initial GPT/filesystem creation and exportable installation blueprints; pinned through NixOS, explicit format mode on verified blank devices |
| [systemd-repart](https://github.com/systemd/systemd/blob/v260/man/systemd-repart.xml) | Native incremental dry-run/allocation; preserves partition starts, does not shrink/delete/move, grows only selected Btrfs Storage |
| [btrfs-progs](https://btrfs.readthedocs.io/en/latest/) | Pool membership, filesystem expansion, checksummed scrub and filtered mirror conversion; existing production pool preserved |
| [smartmontools](https://www.smartmontools.org/) | Hardware health with standby-aware polling |
| NixOS + systemd | Service dependencies, protected local agent, tool versions and UUID-based System-volume mounts |

Disko supports LVM, mdadm, ZFS and more; the current Regado adapter implements
ext4 System areas and membership in an existing Btrfs Storage pool. It does not
pretend that exporting a declaration safely migrates a populated layout between
filesystems. Offline shrinking/removal/movement, boot installation and relocating
service state need an explicit maintenance workflow. Existing data is not wiped
to make an allocation appear successful.

[UDisks2](https://storaged.org/doc/udisks2-api/latest/) and
[Cockpit](https://github.com/cockpit-project/cockpit) are useful interactive
management layers, but this workflow uses Nix declarations and a restricted
agent rather than adding a second mutable disk-management control plane.
[Podman/Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
manages container lifecycle, not disk layout. The current native NixOS/systemd
services remain appropriate; containerizing them would be a separate deployment
migration with its own benefit and data-migration review.

Approval files and before-tables remain in `/var/lib/regado-agent/layout-*`.
Deterministic per-hardware PARTUUIDs avoid role-label collisions during Disko
formatting. Device identity, filesystem signatures, pool membership and native
geometry are checked again before applying. All privileged jobs are serialized.
System volumes are mounted under `/var/lib/kaordo-volumes/<filesystem UUID>`;
Storage joins the selected pool. Requests never contain executable Nix or shell.

## Verification

On 2026-10-04, Disko 1.13.0 and systemd-repart 260.4 were tested on an isolated
loop image inside the production agent sandbox. Disko compiled and initialized
BIOS boot/System/Storage areas, a System volume mounted through host systemd,
and repart grew the adjacent area while preserving starts, UUIDs and System
data. The temporary image and loop device were removed afterward. UEFI
declaration selection is covered by unit tests.

Reproduce on a NixOS test host, as root, with the repository fixture:

```sh
sudo bash deploy/storage/test-layout-tools.sh \
  services/regado-agent/cmd/regado-agent/testdata/storage-layout-bios.nix
```

Go tests inject commands to check preview geometry, root/shrink/signature
protection, stale identity, strict administrator authorization and audit order.
`pnpm test:regado:ui` verifies desired allocations, confirmation, progress,
keyboard/accessibility checks and 320px reflow without manual browser use.
