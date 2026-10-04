#!/usr/bin/env bash
# Exercises Disko and systemd-repart in the agent sandbox using an isolated loop image
set -euo pipefail
umask 077

[[ $EUID == 0 && $# == 1 ]] || { echo "Run as root with the agent's storage-layout-bios.nix fixture" >&2; exit 1; }
task_fixture=$(realpath "$1")
task_work=$(mktemp -d /var/lib/kaordo-storage-tools.XXXXXX)
task_loop=""
cleanup() {
  if mountpoint -q "$task_work/system"; then
    [[ ! -f $task_work/system/keep ]] || unlink "$task_work/system/keep"
    umount "$task_work/system"
  fi
  [[ ! -d $task_work/system ]] || rmdir "$task_work/system"
  if [[ $task_loop =~ ^/dev/loop[0-9]+$ ]] && [[ $(losetup --noheadings --output BACK-FILE "$task_loop") == "$task_work/disk.img" ]]; then
    losetup --detach "$task_loop"
  fi
  for task_file in disko.nix disko-uefi.nix disk.img 001-boot.conf 002-system.conf 003-storage.conf before.json after.json; do
    [[ ! -e $task_work/$task_file ]] || unlink "$task_work/$task_file"
  done
  rmdir "$task_work"
}
trap cleanup EXIT

task_disko=$(nix-build '<nixpkgs>' -A disko --no-out-link)/bin/disko
task_nixpkgs=$(nix-instantiate --find-file nixpkgs)
truncate --size=4G "$task_work/disk.img"
task_loop=$(losetup --find --show --partscan "$task_work/disk.img")
[[ $task_loop =~ ^/dev/loop[0-9]+$ ]] || { echo "Only a loop device can be tested" >&2; exit 1; }
sed "s|device = \"/dev/sdc\";|device = \"$task_loop\";|" "$task_fixture" > "$task_work/disko.nix"
grep -Fq "device = \"$task_loop\";" "$task_work/disko.nix"
! grep -Fq '/dev/sdc' "$task_work/disko.nix"

# The same sandbox settings used by the production agent must support the native tools
sandbox() {
  systemd-run --quiet --wait --pipe --collect \
    --property=ProtectSystem=strict --property=ProtectHome=yes --property=PrivateNetwork=yes --property=PrivateTmp=yes \
    --property=NoNewPrivileges=yes --property=RestrictAddressFamilies=AF_UNIX \
    --property="ReadWritePaths=$task_work" --setenv="NIX_PATH=nixpkgs=$task_nixpkgs" "$@"
}
sandbox "$task_disko" --mode format --dry-run "$task_work/disko.nix"
sandbox "$task_disko" --mode format "$task_work/disko.nix"
udevadm settle --timeout=30
[[ $(blkid --match-tag TYPE --output value "${task_loop}p2") == ext4 ]]
task_system_uuid=$(blkid --match-tag UUID --output value "${task_loop}p2")
sandbox bash -c 'systemd-mount --collect --options=nodev,nosuid "$1" "$2"; mountpoint -q "$2"' test-system-mount "${task_loop}p2" "$task_work/system"
printf 'preserved System data\n' > "$task_work/system/keep"
sfdisk --json "$task_loop" > "$task_work/before.json"

cat > "$task_work/001-boot.conf" <<'CONFIG'
[Partition]
Type=21686148-6449-6e6f-744e-656564454649
SizeMinBytes=2097152
SizeMaxBytes=2097152
CONFIG
cat > "$task_work/002-system.conf" <<'CONFIG'
[Partition]
Type=linux-generic
SizeMinBytes=1073741824
SizeMaxBytes=1073741824
CONFIG
cat > "$task_work/003-storage.conf" <<'CONFIG'
[Partition]
Type=linux-generic
SizeMinBytes=2684354560
SizeMaxBytes=2684354560
CONFIG
sandbox systemd-repart --dry-run=true --empty=refuse --discard=no --json=short --pretty=no --definitions="$task_work" "$task_loop"
sandbox systemd-repart --dry-run=false --empty=refuse --discard=no --json=short --pretty=no --definitions="$task_work" "$task_loop"
udevadm settle --timeout=30
sfdisk --json "$task_loop" > "$task_work/after.json"
[[ $(blkid --match-tag UUID --output value "${task_loop}p2") == "$task_system_uuid" ]]
[[ $(blockdev --getsize64 "${task_loop}p3") == 2684354560 ]]
[[ $(cat "$task_work/system/keep") == 'preserved System data' ]]
# Native growth must preserve partition starts and both existing boot/System areas
nix-shell -p python3 --run "python3 - '$task_work/before.json' '$task_work/after.json'" <<'PY'
import json, sys
before, after = [json.load(open(path))['partitiontable']['partitions'] for path in sys.argv[1:]]
assert len(before) == len(after) == 3
assert all(a['start'] == b['start'] and a['uuid'] == b['uuid'] for a, b in zip(before, after))
assert before[:2] == after[:2]
assert after[2]['size'] > before[2]['size']
print('Disko format and systemd-repart growth passed; System UUID and existing geometry preserved')
PY
