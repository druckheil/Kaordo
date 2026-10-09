# Regado host operations

Regado observes and operates Kaordo hosts. It never edits disks or services ad hoc. Each host has a **desired state document**. The host's `regado-agent` reconciles that document through **operations**, which are persistent, observable jobs. Kerno authorizes and audits every change and delivers alerts. Regado renders all of it.

The same model serves one host with two disks and many hosts with many disks. Nothing in it assumes a device name, a disk count or a host count.

## Ownership

| Component                          | Owns                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Nix configuration (`deploy/nixos`) | Software, services, mounts of the fixed subvolume layout, the agent itself                                                                  |
| `regado-agent` (one per host)      | The host's desired state document and its revisions, the operation journal, the reconciler and scheduler, health facts and alert evaluation |
| Kerno                              | Admin authorization, audit records (with state diffs), the host registry, alert delivery (Ligo system notice, ntfy)                         |
| Regado                             | Presentation and confirmation flows. It never computes host decisions itself                                                                |

The agent's copy is authoritative for its host. Kerno can rebuild its view from the agents at any time. The agent stays offline-capable: schedules, snapshots and integrity checks keep running when Kerno is down.

## Desired state document

Stored at `/var/lib/regado-agent/state/current.json`, together with the last 50 revisions. Every write carries the expected revision. A mismatch is rejected (optimistic concurrency), and Kerno audits the actor, reason and JSON diff.

```json
{
	"revision": 7,
	"pool": {
		"devices": ["wwn-0x50014ee2b1c2d3e4", "wwn-0x50014ee05a6b7c8d"],
		"dataProfile": "raid1",
		"metadataProfile": "auto"
	},
	"volumes": { "postgresql": { "quotaBytes": null }, "media": { "quotaBytes": 600000000000 } },
	"snapshots": { "postgresql": "frequent", "media": "daily", "system": "daily" },
	"integrity": { "scrub": "monthly", "smartShort": "weekly", "smartLong": "monthly" },
	"backups": { "targets": [], "policies": [] },
	"cleanup": { "nixGenerationsDays": 30, "releasesKeep": 3, "journalDays": 14 },
	"alerts": { "ntfy": { "url": "https://ntfy.sh", "topic": "kaordo-…" } }
}
```

- Devices are identified by their `/dev/disk/by-id` WWN, or by `ata-<model>_<serial>` when a disk has no WWN, never by `sdX`.
- `metadataProfile: auto` means `raid1` with two devices and `raid1c3` with three or more. Data stays `raid1` (two copies) unless the operator chooses `raid1c3`. RAID5/6 is not offered.
- Volumes and their mount points are fixed by Nix; the document only sets quotas and snapshot policies for them.
- Secrets never appear in the document. The ntfy token lives in Kerno's environment.
- `GET /state/export` renders the document and the disk template as a disko module, so a lost host can be reinstalled with `nixos-anywhere`.

## Operations

Operations are the only way to change a host. Examples: adding, replacing or removing a device, a scrub, a SMART test, a snapshot run, a backup, a cleanup, a service restart, a journal retention change.

- Stored as JSON under `/var/lib/regado-agent/operations/`, so they survive restarts. An operation that was running when the agent stopped becomes `interrupted`, and its reconciler decides whether to resume it (scrub and balance resume natively) or to report it.
- Fields: ID (UUIDv7), kind, target, reason, requester (account ID or `schedule`), state (`queued`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`), timestamps, error. Ordered stages, each with state, done/total/unit progress and optional detail. A bounded log.
- Mutating operations run one at a time, in order. Read-only ones (SMART reads, inventory) run concurrently.
- Cancellation is offered only where the underlying tool can stop safely. `btrfs balance` and `scrub` can be cancelled; `btrfs replace` can be cancelled before it finishes. Partitioning cannot be cancelled once started.
- Destructive steps require the confirmation that Regado collects (the device serial or the host name). The agent validates it again.
- Retention: the newest 500 operations or 180 days.

## Storage layout

Every disk uses the same template. There are no OS or storage partitions.

| GPT partition                               | Size              | Purpose                                  |
| ------------------------------------------- | ----------------- | ---------------------------------------- |
| 1 `BIOS boot` (or EFI system on UEFI hosts) | 1 MiB (1 GiB EFI) | Bootloader, installed on every pool disk |
| 2 `kaordo-pool`                             | rest              | Member of the host's Btrfs pool          |

The pool holds everything: `@root`, `@nix`, `@log`, `@kaordo/postgresql`, `@kaordo/media`, `@kaordo/prometheus`, `@kaordo/releases` and `@snapshots`. Usage is tracked with Btrfs simple quotas. The boot reconciler keeps GRUB installed on every pool disk and reinstalls it when the system's GRUB changes. Any disk can therefore boot the host. A `degraded` boot entry mounts the pool when a member is missing.

Backup-target disks are not pool members. They hold one independent Btrfs filesystem labelled `kaordo-backup`.

## Device lifecycle

The agent classifies every physical device:

| Class          | Meaning                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `pool`         | A member of this host's pool                                                            |
| `backup`       | An assigned backup target                                                               |
| `blank`        | No partition table or filesystem signatures                                             |
| `foreign`      | Holds data the agent does not own. Never touched without the operator typing its serial |
| `unidentified` | Has no stable `/dev/disk/by-id` name, so the agent cannot manage it                     |

A pool member that is listed in the desired state but absent is reported as `missing` on the pool, and the planner offers to rebuild its copies on a new device or drop it.

| Operation               | Stages                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add to pool             | Verify identity and SMART, wipe after confirmation when the disk is not blank, partition with the template, install the bootloader, `btrfs device add`, rebalance (convert profiles when needed), verify |
| Replace                 | Partition the new disk, `btrfs replace` (works with the old disk missing), resize to the full size, install the bootloader, verify                                                                       |
| Remove                  | Capacity preflight (the remaining devices must hold two copies of the used data), `btrfs device remove`, wipe signatures                                                                                 |
| Assign as backup target | Verify and wipe after confirmation, create the `kaordo-backup` filesystem, register the target                                                                                                           |

Progress comes from the tools themselves: `btrfs balance status`, `btrfs replace status` and device usage while a device is removed.

## Integrity

- **Data integrity.** Btrfs guarantees two copies through the `raid1` profile, and scrub verifies every copy against its checksum, repairing a bad copy from the good one. There is no separate file-copy inventory.
- **Scheduled checks.** Scrub runs monthly, a SMART short test weekly and a long test monthly. Each is an operation.
- **Error signals.** Device error counters (`btrfs device stats`), SMART health and attributes (reallocated, pending and offline-uncorrectable sectors), temperature and profile drift all feed alerts.
- **SMART reads.** The agent reads every identified device every 15 minutes with `--nocheck=standby`, so sleeping disks are not woken; a sleeping disk keeps its last report. Facts include the latest report per device.

## Snapshots and backups

- **Snapshots.** Created by btrbk from a configuration the agent generates from the desired state. They are read-only, atomic per subvolume, and kept with hourly, daily, weekly and monthly retention. They protect against deletion, bad migrations and application bugs, but not against losing the host.
- **Backups.** Snapshots sent incrementally (`btrfs send/receive` through btrbk) to targets, with their own retention.
  - Disk targets are local `kaordo-backup` disks; remote Btrfs hosts are added later.
  - Restore drills mount a backup snapshot read-only, start a temporary PostgreSQL on it and verify it.
  - Restoring promotes a backup snapshot into a new subvolume and switches it in only after the operator confirms.
- **No target yet.** While no backup target exists, Regado shows the risk as a standing warning instead of hiding it.

## Cleanup

Each item reports the space it reclaims, as an operation or schedule:

- unreferenced Nodo uploads (Nodo's reference-checked garbage collection every 6 hours; Regado can run a media check or cleanup on demand, audited by Kerno);
- snapshot and backup retention;
- Nix generations older than the policy, followed by `nix-collect-garbage`;
- release directories beyond `releasesKeep`, never the active or previous one;
- the journal size and age.

## Alerts

The agent evaluates health facts into alerts. Each alert has a stable key, a severity (`warning` or `critical`), a summary and the times it was first seen, last seen and resolved. Kerno polls each host every minute and delivers transitions (opened, escalated, resolved) once:

- **Ligo:** a system notice in each administrator's Saved messages conversation;
- **ntfy:** a push to the configured topic.

Alerts cover:

- a missing device, device errors or failing SMART;
- pool usage above 80% (warning) or 90% (critical);
- a profile mismatch;
- scrub errors;
- a failed operation;
- no backup target, or a backup older than its policy;
- failed systemd units and certificate expiry.

## Multiple hosts

Every API is addressed by host: `/v1/admin/hosts/{host}/…`. Kerno's host registry starts with the local socket. Remote agents join later over a WireGuard mesh with mutual TLS, using the same API. Hosts never share a Btrfs pool. Cross-host redundancy is a service concern: Garage for media and PostgreSQL replication.

## Verification

- **Unit tests.** Go tests inject command output for parsing and planning.
- **Host tests.** A privileged Linux container runs the agent's operations against real `btrfs-progs`, `sgdisk` and btrbk on loop devices: add, replace (also with the old device missing), remove, scrub with injected corruption, snapshots and restore. They run locally (`pnpm test:host`) and in CI.
- **Browser tests.** Playwright fixtures cover Regado flows, confirmations and progress.

## Delivery phases

Done: the operation journal, the desired state store, host addressing in Kerno and the contract, device classification, pool planning and the add, replace, convert and remove operations, SMART facts, and the Regado Storage view. The partition planner, file-copy checker and layout dialog are removed. Everything else below is still to be built.

1. **Foundation.** The operation journal and API, the desired state store with revisions and export, host addressing in Kerno and the contract, alert evaluation and delivery (Ligo and ntfy), and the Regado operations activity view.
2. **Storage.** Device classification and lifecycle operations, the boot reconciler, integrity schedules, space and quota reporting, cleanup. Replaces the partition planner, file-copy checker and layout dialog.
3. **Snapshots and backups.** Through btrbk, plus backup-target disks, restore drills and restore.
4. **Host migration.** Reinstall production onto the uniform template with nixos-anywhere and disko, after a verified copy of the databases. Needs the operator's explicit confirmation.
5. **Console.** The Overview health summary, Logs (time range, filters, cursor pagination, live tail), Users, Audit and System.
6. **Fleet.** Remote agents over WireGuard, Garage for media, PostgreSQL replication. Done when a second host exists.
