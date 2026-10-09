# Storage

Production data lives on `Data1`, a Btrfs filesystem with RAID1 data and metadata across two physical disks, mounted at `/srv/kaordo`. NixOS has a separate root partition on one disk. RAID1 survives one disk failing. It does not protect against deletion, corruption written to both copies or loss of the host, so an independent backup destination is still required (see [local backups](../local/README.md#backups)).

## Regado storage operations

Regado manages storage through `regado-agent` only. Every operation is fixed, serialized with other privileged jobs, and audited by Kerno before it runs.

- **Check** runs a read-only `btrfs scrub` (capped at 64 MiB/s per device) and inventories regular files. Placement is reported from whole-pool profiles; mixed or unknown profiles stay unverified, never guessed. Scrub cannot validate NOCOW data.
- **Repair** requires every member online. It converts only non-redundant block groups to RAID1 and runs a repairing scrub. Nodo separately removes expired upload artifacts after re-checking references. The agent never deletes application files.
- **Role allocation** follows the model host → physical device → partition → System or Storage role. Devices are identified by WWN or a stable serial; ambiguous identity, active swap or unmanaged volumes need operator review.
  - Blank devices are initialized by [Disko](https://github.com/nix-community/disko) in format mode, after a compile-only dry run.
  - Existing GPT layouts use [systemd-repart](https://www.freedesktop.org/software/systemd/man/latest/systemd-repart.html) with `--empty=refuse`, dry run first. It preserves partition starts and never shrinks, deletes or moves.
  - Only Btrfs Storage grows online. New System ext4 volumes mount by UUID under `/var/lib/kaordo-volumes`.
  - Plans return a geometry fingerprint. Applying requires that fingerprint and the exact device path, and identity and geometry are re-checked immediately before mutation.
  - Approval workspaces are kept in `/var/lib/regado-agent/layout-*`. NixOS rebuilds never apply a pending plan.

Shrinking, moving, installing another OS or relocating service state are offline operator work, not agent operations.

## Verification

Go tests inject command output to cover parsing, root and signature protection, stale identity and audit order. `pnpm test:regado:ui` covers the Regado flows. The native tools are exercised on a NixOS host, as root, against a temporary loop image (never a physical disk):

```sh
sudo bash deploy/storage/test-layout-tools.sh \
  services/regado-agent/internal/agent/testdata/storage-layout-bios.nix
```
