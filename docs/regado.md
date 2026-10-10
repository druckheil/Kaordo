# Regado host operations

Regado observes and operates Kaordo hosts. It never edits disks or services ad hoc. Each host has a **desired state document**. The host's `regado-agent` reconciles that document through **operations**, which are persistent, observable jobs. Kerno authorizes and audits every change and delivers alerts. Regado renders all of it.

The same model serves one host with two disks and many hosts with many disks. Nothing in it assumes a device name, a disk count or a host count.

This document describes the implemented operations and the remaining design. Quotas, scheduled snapshots, backup targets, recovery export and remote hosts are still planned; storing their policy fields does not apply them yet.

## Ownership

| Component                          | Owns                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Nix configuration (`deploy/nixos`) | Software, services, mounts of the fixed subvolume layout, the agent itself                                                                  |
| `regado-agent` (one per host)      | The host's desired state document and its revisions, the operation journal, the reconciler and scheduler, health facts and alert evaluation |
| Kerno                              | Admin authorization, audit records (with state diffs), the host registry, alert delivery (Ligo system notice, ntfy)                         |
| Regado                             | Presentation and confirmation flows. It never computes host decisions itself                                                                |

The agent's copy is authoritative for its host. Kerno can rebuild its view from the agents at any time. Integrity schedules and alert evaluation keep running when Kerno is down; notification delivery resumes through Kerno.

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
	"snapshots": {
		"postgresql": {
			"schedule": "hourly",
			"keepHourly": 24,
			"keepDaily": 7,
			"keepWeekly": 4,
			"keepMonthly": 3
		},
		"media": {
			"schedule": "daily",
			"keepHourly": 0,
			"keepDaily": 7,
			"keepWeekly": 4,
			"keepMonthly": 3
		},
		"system": {
			"schedule": "daily",
			"keepHourly": 0,
			"keepDaily": 7,
			"keepWeekly": 2,
			"keepMonthly": 0
		}
	},
	"integrity": { "scrub": "monthly", "smartShort": "weekly", "smartLong": "monthly" },
	"backups": { "targets": [], "policies": [] },
	"cleanup": { "nixGenerationsDays": 30, "releasesKeep": 3, "journalDays": 14 },
	"alerts": {
		"poolWarningPercent": 80,
		"poolCriticalPercent": 90,
		"ntfy": { "url": "https://ntfy.sh", "topic": "kaordo-example" }
	}
}
```

- Devices are identified by their `/dev/disk/by-id` WWN, or by `ata-<model>_<serial>` when a disk has no WWN, never by `sdX`.
- `metadataProfile: auto` means `raid1` with two devices and `raid1c3` with three or more. Data stays `raid1` (two copies) unless the operator chooses `raid1c3`. RAID5/6 is not offered.
- Volumes and their mount points are fixed by Nix; the document only sets quotas and snapshot policies for them.
- Secrets never appear in the document. The ntfy token lives in Kerno's environment.
- Planned: `GET /state/export` will render the document and the disk template as a disko module for reinstalling a lost host. This route is not implemented.

## Operations

Regado changes a host through operations: pool changes, integrity checks and journal retention are implemented. Snapshot, backup and other retention operations are planned. The authorized one-time production migration uses the operator scripts in `deploy/nixos`, which take the deployment lock and pause the agent during partition changes.

- Stored as JSON under `/var/lib/regado-agent/operations/`, so they survive restarts. An operation that was running when the agent stopped becomes `interrupted`, and its reconciler decides whether to resume it (scrub and balance resume natively) or to report it.
- Fields: ID (UUIDv7), kind, target, reason, requester (account ID or `schedule`), state (`queued`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`), timestamps, error. Ordered stages, each with state, done/total/unit progress and optional detail. A bounded log.
- Mutating operations run one at a time, in order. Read-only ones (SMART reads, inventory) run concurrently.
- Cancellation is offered only where the underlying tool can stop safely. `btrfs balance` and `scrub` can be cancelled; `btrfs replace` can be cancelled before it finishes. Partitioning cannot be cancelled once started.
- Destructive steps require the confirmation that Regado collects (the device serial or the host name). The agent validates it again.
- Storing a document whose pool section is unchanged never reads or changes disks. The pool dialog sets `converge` to finish drift with the same pool.
- Retention: the newest 500 operations or 180 days.

## Storage layout

Every disk uses the same template. There are no OS or storage partitions.

| GPT partition                               | Size              | Purpose                                                  |
| ------------------------------------------- | ----------------- | -------------------------------------------------------- |
| 1 `BIOS boot` (or EFI system on UEFI hosts) | 2 MiB (1 GiB EFI) | BIOS GRUB on each pool disk; EFI installation is planned |
| 2 `kaordo-pool`                             | rest              | Member of the host's Btrfs pool                          |

The pool holds `@root`, `@nix`, `@log`, `@kaordo/postgresql`, `@kaordo/media`, `@kaordo/prometheus`, `@kaordo/releases` and an empty `@snapshots` destination. Quota enforcement and subvolume usage reporting are planned. On the BIOS production host, NixOS installs GRUB on every present desired pool disk; the agent installs it during add and replace operations after detecting that the root is on the pool. A `degraded` boot entry is configured for a missing member. Normal boot from the pool has been verified; production boot with a disk physically absent has not been tested. EFI partitioning exists, but agent bootloader installation for EFI is not implemented.

Planned backup-target disks are independent of the pool and will hold a Btrfs filesystem labelled `kaordo-backup`.

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

| Operation                         | Stages                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add to pool                       | Verify identity and SMART, wipe after confirmation when the disk is not blank, partition with the template, install the bootloader, `btrfs device add`, rebalance (convert profiles when needed), verify |
| Replace                           | Partition the new disk, `btrfs replace` (works with the old disk missing), resize to the full size, install the bootloader, verify                                                                       |
| Remove                            | Capacity preflight (the remaining devices must hold two copies of the used data), `btrfs device remove`, wipe signatures                                                                                 |
| Assign as backup target (planned) | Verify and wipe after confirmation, create the `kaordo-backup` filesystem, register the target                                                                                                           |

Progress comes from the tools themselves: `btrfs balance status`, `btrfs replace status` and device usage while a device is removed.

## Integrity

- **Data integrity.** Btrfs keeps two copies through the `raid1` profile. Scrub reads the entire pool, including the operating system, Nix store, databases, media and filesystem metadata; it verifies available checksums and repairs a bad copy from a good one. Data without checksums, such as NOCOW journals, is checked for read errors but cannot be validated for silent corruption. There is no separate file-copy inventory.
- **Scheduled checks.** Scrub runs monthly, a SMART short test weekly and a long test monthly by default; the desired state sets each to off, weekly or monthly. The agent's scheduler starts a due check between 02:00 and 06:00 host time, one check at a time, in the order scrub, long test, short test. A long test also counts as a short one. Interrupted runs retry; failed runs wait for the next interval and raise an alert.
- **Scrub.** `btrfs scrub start -B --limit 64m` reads every copy, with progress from `btrfs scrub status`. It queues behind pool changes. Corrected blocks are logged; any uncorrectable block fails the operation. Operators can run any check now. Kerno audits every action; reasons are optional and limited to 500 characters. The agent reads scrub and SMART progress every five seconds, and Regado refreshes operation status, expanded logs and active media checks every five seconds. Drive firmware may report SMART progress in larger steps.
- **Self-tests.** `smartctl --test` runs on each pool and backup disk in turn, polled until the drive reports a result (ATA and NVMe). Each disk's stage records its own result, even when another disk fails. Stopping a running test aborts it on the drive and waits for it to stop before the operation finishes. Disks whose SMART cannot be read are skipped.
- **Error signals.** Device error counters (`btrfs device stats`), SMART health and attributes (reallocated, pending and offline-uncorrectable sectors), temperature and profile drift all feed alerts.
- **SMART reads.** The agent reads every identified device every 15 minutes with `--nocheck=standby`, so sleeping disks are not woken; a sleeping disk keeps its last report. Facts include the latest report per device.

## Snapshots and backups

Scheduled snapshots, backup-target lifecycle and restoration through Regado are not implemented. The desired state validates their policy fields for future use. The production migration used an independent encrypted restic checkpoint with verified database restores; this is a one-time operator copy, not a scheduled backup.

- **Planned snapshots.** btrbk will consume configuration generated from the desired state. Snapshots will be read-only and atomic per subvolume, with hourly, daily, weekly and monthly retention. They can protect against deletion and application bugs, but not against losing the host. A PostgreSQL recovery workflow also needs matching cluster state and runtime.
- **Planned backups.** Snapshots sent incrementally (`btrfs send/receive` through btrbk) to targets, with their own retention.
  - Disk targets are local `kaordo-backup` disks; remote Btrfs hosts are added later.
  - Restore drills mount a backup snapshot read-only, start a temporary PostgreSQL on it and verify it.
  - Restoring promotes a backup snapshot into a new subvolume and switches it in only after the operator confirms.
- **No target yet.** While no backup target exists, Regado shows the risk as a standing warning instead of hiding it.

## Cleanup

Implemented cleanup:

- unreferenced Nodo uploads (Nodo's reference-checked garbage collection every 6 hours; Regado can run a media check or cleanup on demand, audited by Kerno);
- the journal's age: `cleanup.journalDays` is the only source, edited from Regado's Logs tab. The agent applies a change as a `cleanup.journal` operation, keeps an existing setting when it first adopts the host, and reapplies the desired value when journald reports another one.

Planned: snapshot and backup retention, Nix generation retention and garbage collection, release directories beyond `releasesKeep` (preserving active and previous releases), and reports of reclaimed space. The migration's selective retirement of ext4 boot generations is an operator step, not an implemented retention scheduler.

## Alerts

The agent evaluates its facts into alerts every minute. Each alert has a stable key, a severity (`warning` or `critical`), a summary and the times it was first seen, last seen and resolved. Every transition (opened, escalated, resolved) gets a sequence number in `/var/lib/regado-agent/alerts`.

Kerno polls `GET /alerts?after=<cursor>` on each host every minute and delivers each transition once, in order. The cursor lives in `regado_alert_cursors`. Transitions older than 24 hours are skipped, so a reset never replays history as news.

- **Ligo:** a plaintext system notice in each active administrator's Saved messages. This is the durable record; the cursor advances only after it is stored.
- **ntfy:** a push to the topic in the desired state, with a link to Regado. It is best effort. A token for protected topics is read from `KAORDO_NTFY_TOKEN` in Kerno's environment.

Regado lists open and recently resolved alerts, edits the topic and usage thresholds, and sends an audited test notice.

Alerts cover:

- a missing pool device, and device error counters above zero;
- a failed SMART self-assessment (critical) or reallocated, pending or unreadable sectors (warning) on pool and backup disks;
- pool usage above the warning (default 80%) and critical (default 90%) thresholds;
- a pool that differs from its desired state, or mixes profiles, while no pool change is running;
- a failed pool change, copy verification or self-test, until a later run succeeds;
- no backup target.

Still to come: a backup older than its policy, failed systemd units and certificate expiry.

## Multiple hosts

Every API is addressed by host: `/v1/admin/hosts/{host}/…`. Kerno's host registry starts with the local socket. Remote agents join later over a WireGuard mesh with mutual TLS, using the same API. Hosts never share a Btrfs pool. Cross-host redundancy is a service concern: Garage for media and PostgreSQL replication.

## Verification

- **Unit tests.** Go tests inject command output for parsing and planning.
- **Host tests.** A privileged Linux container runs real `btrfs-progs` and `sgdisk` on loop devices: add, replace (also with the old device missing), remove, scrub with injected corruption, system-data migration and both legacy partition reshapes while preserving RAID1. They run locally (`pnpm test:host`) and in CI. Snapshot scheduling and restoration through Regado are not covered because they are not implemented.
- **Browser tests.** Playwright fixtures cover Regado flows, confirmations and progress.

## Delivery phases

Implemented: the operation journal and activity view, desired state with revisions, host addressing, device classification, pool planning and add/replace/convert/remove operations, SMART facts, scheduled and on-demand integrity checks, Ligo and ntfy alert delivery, the Storage view, and journal retention from the desired state. The partition planner, file-copy checker and layout dialog are removed. BIOS bootloader installation is enabled for pool-root hosts. The system migration and partition reshape scripts are covered by regression and real Btrfs host tests.

Production migration evidence and runtime limitations are recorded in [Production pool migration, 2026-10-10](storage-migration-2026-10-10.md).

Remaining work:

1. **Storage policies.** Subvolume quotas and usage reporting; Nix and release retention.
2. **Snapshots and backups.** Scheduled btrbk snapshots, backup-target disks, restore drills and restore. Independent scheduled backup destinations remain operator configuration.
3. **Recovery export.** Generate a reinstallable Nix/disko description from the desired state.
4. **Console.** Extend the existing Overview, Logs, Users, Audit and System views with the planned summaries, filters, pagination and live tail.
5. **Fleet.** Remote agents over WireGuard, Garage for media and PostgreSQL replication when a second host exists.
