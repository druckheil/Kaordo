# Production pool migration, 2026-10-10

The authorized migration completed on 2026-10-10, moving the existing NixOS system and Kaordo data into the two-disk `Data1` Btrfs pool. It preserved the application and identity databases, media, server keys and host state without recreating either database. Dates in this record use Europe/Berlin; the deployment identifier uses UTC.

## Deployed source

- Migration scripts: `83d3477d7f9aa720bca2d07c053bb7e170b5ed1b`
- Mount dependency correction: `4f6993808fd5707e58e62df8c27c03dc8d1cd206`
- Helper hardening for a pre-registered target: `aea4e82846fd7c06c680b1b25e40413cb785834a` (repository only; not part of the active release)
- Active full release: `v0.0.4-4f6993808fd5-20261009T232132Z-full`
- Pool-root NixOS closure: `/nix/store/g8gz4gawrcrqi31fr8084mkq1jmads1d-nixos-system-hp-microserver-26.05.11045.774debe7a0d1`
- Kernel: `6.18.54`; PostgreSQL: `18.6`

The migration used two one-time scripts, `deploy/nixos/migrate-to-pool.sh` and `deploy/nixos/reshape-pool.sh` (last present in `a945c9e`; removed once production finished, since no other host runs the legacy layout). The former recorded its stages and original data manifest. The latter replaces a member into a temporary partition on the same physical disk before extending that partition; the other physical mirror remains present. No member is dropped and re-added, and no profile is converted to `single`.

## Recovery checkpoint

An encrypted restic repository was created on the operator's Mac before the old root was retired. It contains logical dumps of both databases, PostgreSQL global roles, host configuration, SSH keys, service secrets, media and agent state. A second archive captures the complete PostgreSQL data directory and host state with all application services and PostgreSQL stopped immediately before the trial boot. Original GPT tables are included for diagnosis.

Both logical databases were restored into isolated PostgreSQL 18.6 containers with no network, no published ports and temporary database storage. A second drill applied the global roles and preserved the original database ownership and grants. The physical archive also started and returned the same account counts and migration version. Containers were removed after verification. `restic check --read-data` checked every repository pack without errors.

The physical drill used a different libc collation version (production 2.42, test container 2.41). Physical recovery needs the matching NixOS runtime, or index rebuilding and collation-version refresh on another runtime. Logical recovery was verified separately. The owner-only `RECOVERY.md` beside the repository records recovery commands and archive handling; credentials and backups remain outside Git.

After the final boot, fresh logical dumps, global roles and host state were added with tag `migration-complete-4f69938`. The logical dumps were restored again with original ownership: 32 application tables owned by `kaordo`, 100 identity tables owned by `keycloak`, the same account counts and migration version. The complete repository check passed for all 10 snapshots and 20 packs. These checkpoints are independent one-time recovery copies. Scheduled external backups are not enabled.

## System cutover

The first pass copied the running system into `@root`, `@nix` and `@log` and built the pool-root closure. During cutover, services stopped for the second synchronization and the existing data was reflinked into `@kaordo`, with nested `postgresql`, `media`, `prometheus` and `releases` subvolumes. The copy retained ownership, permissions, timestamps and links; the migration's comparison passed.

The one-time trial boot returned over SSH with all four mounts on the pool. Finalization installed GRUB on both physical disks and made the new closure the default. A subsequent ordinary reboot returned to that default closure without the trial entry.

The first partition replacement exposed a systemd dependency defect: when the source device disappeared, systemd stopped application services and unmounted the logs and data paths, despite the Btrfs pool remaining available. PostgreSQL shut down cleanly. The mounts and services were restored, and scrub passed without errors. Commit `4f69938` adds `x-systemd.device-bound=false` to all pool mounts, following the [systemd mount option](https://github.com/systemd/systemd/blob/v260/man/systemd.mount.xml). It was delivered as a complete release with manifest verification. Updating an already mounted system retained its prior dependencies. After a fresh boot, all three non-root pool mounts retained the option and reported empty `StopPropagatedFrom` and `BindsTo` dependencies; services and full release verification passed.

Creating the second disk's temporary target exposed another host difference: the kernel registered partition 2 during GPT refresh, so the following explicit `partx --add` refused to add it again. The script stopped before changing the pool. Its GPT offsets, kernel offsets, size and empty filesystem state were checked, then the deployed script resumed from the existing target. The repository helper now handles an already registered target and checks its kernel geometry before any pool resize or wipe. The real Btrfs rehearsal reproduces this registration behavior. This helper hardening is committed for future releases; the migration itself runs the verified `4f69938` deployment.

| Mount         | Btrfs subvolume |
| ------------- | --------------- |
| `/`           | `@root`         |
| `/nix`        | `@nix`          |
| `/var/log`    | `@log`          |
| `/srv/kaordo` | `@kaordo`       |

An empty `@snapshots` destination exists. Quotas and scheduled snapshots are not implemented or enabled.

## Disk layout

Both physical disks now use the same GPT template. The former 64 GiB ext4 root and the unused 64 GiB front gap have been incorporated into the pool. The two RAID1 members each occupy 931.51 GiB; system and application data share the same free space.

| Partition | Start sector | End sector | Type             | Name          |
| --------- | ------------ | ---------- | ---------------- | ------------- |
| 1         | 2048         | 6143       | BIOS boot, 2 MiB | `kaordo-boot` |
| 2         | 6144         | 1953525134 | Btrfs pool       | `kaordo-pool` |

Both disks use 512-byte logical sectors. Partition 3 is absent. Data, metadata and system allocation profiles remain RAID1, with two physical members. GRUB installation completed on each disk after its replacement.

Scrub passed after each disk: 3 minutes 8 seconds after the first replacement and 3 minutes 15 seconds after the second, with no corrected or uncorrectable errors. Device error counters remained zero. Both disks passed SMART self-assessment with reallocated, pending and offline-uncorrectable sector counts at zero.

The recorded pre-migration data entries were removed only after finalization and successful checks. System generations 1–28, whose fstab referenced the retired ext4 UUID, were deleted; pool-root generations 29–32 remained. GRUB was reinstalled on both disks, its configuration passed syntax checking and no longer referenced the retired root.

The final ordinary reboot returned to the recorded `g8gz4gawrcrqi31fr8084mkq1jmads1d` closure with boot ID `6c4d6b0c-9ef2-48d6-905c-21488a468706`. Mount, GPT, SMART, Btrfs, service, full manifest and database checks passed again. There were no failed systemd units. Regado's host API reported two present RAID1 members with zero errors and no drift from desired state revision 1.

## Verification scope

- Deployment regressions: all 15 tests passed, including failed-cutover recovery, early-cleanup rejection, recorded-closure validation and preservation of entries created after cutover.
- `pnpm test:host`: all nine Go test packages passed. Storage scenarios use real Btrfs loop devices. The migration test covers reflinks, permissions, links and hidden paths. The partition test rehearses both legacy layouts, preserves RAID1, rescans after the simulated reboot and verifies scrub results; it also reproduces a target registered by the kernel before the explicit add.
- `pnpm lint:go`: all four modules reported zero issues. Shell syntax and ShellCheck passed for both migration scripts.
- The production deployment preflight passed its static application build and production checks, authentication tests, deployment tests, Go race tests and vet.
- `verify-release.mjs` passed after the trial and ordinary boots, including service/timer status, installed/running binaries, every static app, OIDC/login/theme, LiveKit and Prometheus.
- Application schema remained at Goose migration 2, with one application account. Keycloak retained four identity accounts and two realms.

No CI workflow was changed. The full browser/integration matrix was not rerun for this migration; prior results are historical. A degraded boot entry is configured, but boot with a physically missing disk has not been tested on production.
