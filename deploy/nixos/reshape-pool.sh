#!/usr/bin/env bash
# Moves legacy pool partitions to the front of their disks while keeping both RAID1 members
set -euo pipefail
umask 077

pool=/srv/kaordo
boot_directory=/boot
records=/var/lib/kaordo-pool-reshape
partition_separator=

die() { echo "reshape-pool: $*" >&2; exit 1; }
step() { echo "== $*"; }

verify_pool() {
  local show profiles
  show=$(btrfs filesystem show "$pool")
  [[ "$(grep -c 'devid' <<<"$show")" -eq 2 ]] || die 'this migration requires exactly two pool members'
  ! grep -q missing <<<"$show" || die 'a pool member is missing'
  profiles=$(btrfs filesystem df "$pool")
  if grep -E '^(Data|Metadata|System),' <<<"$profiles" | grep -vq ', RAID1:'; then
    die 'all pool profiles must remain RAID1'
  fi
  btrfs device stats --check "$pool" >/dev/null || die 'a pool device reports errors'
  btrfs balance status "$pool" | grep -q 'No balance found' || die 'a balance is running'
}

member_id() {
  btrfs filesystem show "$pool" | awk -v path="$1" '$NF == path {print $2}'
}

partition_info() {
  sgdisk --info="$2" "$1"
}

verify_boot_partition() {
  local info
  info=$(partition_info "$1" 1)
  grep -q 'BIOS boot partition' <<<"$info" || die 'partition 1 is not a BIOS boot partition'
  [[ "$(awk '/First sector:/ {print $3}' <<<"$info")" == 2048 &&
    "$(awk '/Last sector:/ {print $3}' <<<"$info")" == 6143 ]] || die 'the legacy BIOS partition does not match the 2 MiB template'
}

renumber() {
  local disk=$1 info start
  verify_pool
  verify_boot_partition "$disk"
  [[ -n "$(member_id "${disk}${partition_separator}2")" ]] || die 'partition 2 is not the current pool member'
  info=$(partition_info "$disk" 3)
  ! grep -q 'First sector:' <<<"$info" || die 'partition 3 is already occupied'
  info=$(partition_info "$disk" 2)
  start=$(awk '/First sector:/ {print $3}' <<<"$info")
  [[ "$start" -gt 6144 ]] || die 'there is no free space before the pool member'
  mkdir -p "$records"
  sgdisk --backup="$records/$(basename "$disk").before-renumber.gpt" "$disk" >/dev/null
  # Only the GPT entry number changes; its start, length and unique GUID stay identical
  sgdisk --transpose=2:3 "$disk"
  step 'partition 2 is now partition 3 in GPT; reboot before running move'
}

move() {
  local disk=$1 source="${1}${partition_separator}3" target="${1}${partition_separator}2" info start devid bytes used guid filesystem
  verify_pool
  verify_boot_partition "$disk"
  devid=$(member_id "$source")
  [[ -n "$devid" ]] || die 'partition 3 must be the pool member; reboot after renumbering first'
  info=$(partition_info "$disk" 3)
  start=$(awk '/First sector:/ {print $3}' <<<"$info")
  [[ "$start" -gt 6144 ]] || die 'there is no space before partition 3'
  info=$(partition_info "$disk" 2)
  if ! grep -q 'First sector:' <<<"$info"; then
    sgdisk --new="2:6144:$((start - 1))" --typecode=2:8300 --change-name=2:kaordo-pool "$disk"
    partx --add --nr 2 "$disk"
    info=$(partition_info "$disk" 2)
  fi
  [[ "$(awk '/First sector:/ {print $3}' <<<"$info")" == 6144 &&
    "$(awk '/Last sector:/ {print $3}' <<<"$info")" == "$((start - 1))" ]] || die 'partition 2 does not exactly fill the unused front of the disk'
  ! findmnt --noheadings --source "$target" >/dev/null || die 'the target partition is mounted'
  [[ -z "$(member_id "$target")" ]] || die 'the target is already a pool member'
  filesystem=$(blkid -s TYPE -o value "$target" || true)
  if [[ -n "$filesystem" ]]; then
    [[ "$filesystem" == ext4 && "$(blkid -s LABEL -o value "$target")" == NixOS ]] || die 'the target holds an unexpected filesystem'
  fi
  bytes=$(blockdev --getsize64 "$target")
  used=$(btrfs filesystem usage -b "$pool" | awk '/^[[:space:]]*Used:/ {print $2; exit}')
  [[ "$used" =~ ^[0-9]+$ && "$bytes" -gt "$((used * 2))" ]] || die 'the temporary target has insufficient space for the mirrored data and relocation workspace'
  mkdir -p "$records"
  sgdisk --backup="$records/$(basename "$disk").before-move.gpt" "$disk" >/dev/null
  step "shrinking member $devid to the size of its temporary target"
  btrfs filesystem resize "$devid:$bytes" "$pool"
  step 'replacing within the same physical disk; the other physical mirror remains present'
  wipefs --all "$target"
  btrfs replace start -B "$devid" "$target" "$pool"
  [[ "$(member_id "$target")" == "$devid" && -z "$(member_id "$source")" ]] || die 'replacement did not finish on the expected partition'
  verify_pool
  step 'retiring the empty source partition and extending the replacement'
  wipefs --all "$source"
  guid=$(awk '/Partition unique GUID:/ {print $4}' <<<"$info")
  sgdisk --delete=3 --delete=2 --new=2:6144:0 --typecode=2:8300 --change-name=1:kaordo-boot --change-name=2:kaordo-pool --partition-guid="2:$guid" "$disk"
  partx --delete --nr 3 "$disk"
  partx --update --nr 2 "$disk"
  btrfs filesystem resize "$devid:max" "$pool"
  verify_pool
  if [[ -n "$boot_directory" ]]; then grub-install --target=i386-pc --boot-directory="$boot_directory" "$disk"; fi
  step 'the disk now has one BIOS boot partition and one full-sized pool partition'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ $EUID -eq 0 ]] || die 'run as root'
  [[ "${1:-}" == renumber || "${1:-}" == move ]] || die 'usage: reshape-pool.sh renumber|move <disk-by-id> <serial>'
  [[ $# -eq 3 && "$2" =~ ^[A-Za-z0-9._:-]+$ ]] || die 'a stable disk ID and its serial are required'
  [[ "$(findmnt -n -o FSROOT /)" == /@root && "$(findmnt -n -o UUID /)" == "$(findmnt -n -o UUID "$pool")" ]] || die 'finalize the pool-root migration first'
  [[ -f /var/lib/kaordo-pool-migration-finalized ]] || die 'the finalized system migration marker is missing'
  disk=$(readlink -f "/dev/disk/by-id/$2")
  [[ -b "$disk" && "$(lsblk -dn -o TYPE "$disk")" == disk ]] || die 'the ID must identify a whole physical disk'
  [[ "$(lsblk -dn -o SERIAL "$disk" | xargs)" == "$3" ]] || die 'the disk serial does not match'
  if [[ "$disk" =~ [0-9]$ ]]; then partition_separator=p; fi
  records="$records/$2"
  mkdir -p "$pool/tmp"
  lock="$pool/tmp/production-deploy.lock"
  mkdir "$lock" 2>/dev/null || die 'another deployment or migration is running'
  agent_active=0
  if systemctl is-active --quiet regado-agent; then agent_active=1; fi
  finish() {
    local status=$?
    trap - EXIT
    if [[ "$agent_active" -eq 1 ]]; then systemctl start regado-agent || true; fi
    rmdir "$lock" 2>/dev/null || true
    exit "$status"
  }
  trap finish EXIT
  systemctl stop regado-agent
  "$1" "$disk"
fi
