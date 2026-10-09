#!/usr/bin/env bash
# Moves the running NixOS system into subvolumes of the Data1 pool and boots it once on trial
#
# Stages, run as root in order:
#   check     verifies the pool, free space and that this release ships storage.nix
#   prepare   copies the system into @root, @nix and @log while services run, and builds it
#   cutover   stops services, syncs again, moves data into @kaordo and arms one trial boot
#   finalize  on the trial-booted system: makes it the default and installs GRUB on every pool disk
#   cleanup   after finalize: removes the pre-migration data from the pool's top level
#
# Until finalize, the old system stays the default: if the trial boot fails, power-cycling the
# host starts the old system with its data untouched.
set -euo pipefail
umask 077

label=Data1
top=/mnt/kaordo-pool
built=/root/kaordo-pool-system
entry='Kaordo on the pool (trial)'
nested=(postgresql media prometheus releases)
services=(caddy kerno nodo keycloak postgresql livekit prometheus prometheus-node-exporter regado-agent ddclient.timer ddclient)

die() { echo "migrate-to-pool: $*" >&2; exit 1; }
step() { echo "== $*"; }


mount_top() {
  mkdir -p "$top"
  mountpoint -q "$top" || mount -o subvolid=5,compress=zstd:3,noatime "/dev/disk/by-label/$label" "$top"
}

root_on_pool() {
  [[ "$(findmnt -n -o FSTYPE /)" == btrfs && "$(findmnt -n -o UUID /)" == "$(blkid -s UUID -o value "/dev/disk/by-label/$label")" ]]
}

ensure_subvolume() {
  [[ -d "$1" ]] && btrfs subvolume show "$1" >/dev/null 2>&1 && return
  [[ ! -e "$1" ]] || die "$1 exists but is not a subvolume"
  btrfs subvolume create "$1" >/dev/null
}

# Copies the system while it runs; a second pass during cutover catches what changed
sync_system() {
  rsync -aHAX --numeric-ids --delete --one-file-system \
    --exclude=/nix --exclude=/var/log --exclude=/srv --exclude=/tmp --exclude=/mnt --exclude=/root/kaordo-pool-system \
    / "$top/@root/"
  mkdir -p "$top/@root/nix" "$top/@root/var/log" "$top/@root/srv/kaordo" "$top/@root/tmp" "$top/@root/mnt"
  chmod 1777 "$top/@root/tmp"
  rsync -aHAX --numeric-ids --delete /nix/ "$top/@nix/"
  rsync -aHAX --numeric-ids --delete /var/log/ "$top/@log/"
}

check() {
  [[ $EUID -eq 0 ]] || die 'run as root'
  root_on_pool && die 'the system already runs from the pool'
  [[ -f /etc/nixos/deploy/nixos/storage.nix ]] || die 'deploy a release that ships storage.nix first'
  mount_top
  local show
  show=$(btrfs filesystem show "$top")
  grep -q 'missing' <<<"$show" && die 'a pool device is missing'
  [[ "$(grep -c 'devid' <<<"$show")" -ge 2 ]] || die 'the pool needs two devices'
  btrfs filesystem df "$top" | grep -q '^Data, RAID1' || die 'pool data is not RAID1'
  if btrfs device stats "$top" | grep -vq ' 0$'; then die 'a pool device reports errors'; fi
  btrfs balance status "$top" | grep -q 'No balance found' || die 'a balance is running'
  local needed available
  needed=$(df --output=used -B1 / | tail -1)
  available=$(btrfs filesystem usage -b "$top" | awk '/Free \(estimated\)/ {print $3}')
  (( available > needed * 3 )) || die 'the pool has too little free space for a copy of the system'
  step 'ready to prepare'
}

patch_configuration() {
  local etc="$top/@root/etc/nixos"
  grep -q 'deploy/nixos/storage.nix' "$etc/configuration.nix" ||
    sed -i 's|\./deploy/nixos/kaordo\.nix|./deploy/nixos/kaordo.nix ./deploy/nixos/storage.nix|' "$etc/configuration.nix"
  # storage.nix owns the bootloader devices and the root filesystem now
  perl -0pi -e 's/\n\s*boot\.loader\.grub = \{.*?\n\s*\};\n/\n/s' "$etc/configuration.nix"
  perl -0pi -e 's/\n\s*fileSystems\."\/" =\s*\{.*?\};\n/\n/s' "$etc/hardware-configuration.nix"
  grep -q 'storage.nix' "$etc/configuration.nix" || die 'could not import storage.nix'
  if grep -q 'boot.loader.grub = {' "$etc/configuration.nix"; then die 'could not remove the old bootloader block'; fi
  if grep -q 'fileSystems."/"' "$etc/hardware-configuration.nix"; then die 'could not remove the old root filesystem'; fi
}

prepare() {
  check
  for name in @root @nix @log @kaordo @snapshots; do ensure_subvolume "$top/$name"; done
  step 'copying the running system'
  sync_system
  patch_configuration
  step 'building the system for the pool'
  (cd /root && nixos-rebuild build -I nixos-config="$top/@root/etc/nixos/configuration.nix")
  ln -sfn "$(readlink -f /root/result)" "$built"
  rm -f /root/result
  grep -q 'subvol=@root' "$built/etc/fstab" || die 'the built system does not mount @root'
  step "prepared $(readlink -f "$built")"
}

# Recreates @kaordo from the old top level with reflinks: no data is rewritten or duplicated
move_data() {
  if btrfs subvolume show "$top/@kaordo" >/dev/null 2>&1; then
    for name in "${nested[@]}"; do
      [[ ! -d "$top/@kaordo/$name" ]] || btrfs subvolume delete "$top/@kaordo/$name" >/dev/null 2>&1 || true
    done
    btrfs subvolume delete "$top/@kaordo" >/dev/null
  fi
  btrfs subvolume create "$top/@kaordo" >/dev/null
  chmod --reference="$top" "$top/@kaordo"
  local entry name
  for entry in "$top"/* "$top"/.[!.]*; do
    [[ -e "$entry" ]] || continue
    name=$(basename "$entry")
    [[ "$name" == @* ]] && continue
    if [[ " ${nested[*]} " == *" $name "* ]]; then
      btrfs subvolume create "$top/@kaordo/$name" >/dev/null
      chown --reference="$entry" "$top/@kaordo/$name"
      chmod --reference="$entry" "$top/@kaordo/$name"
      cp -a --reflink=always "$entry/." "$top/@kaordo/$name/"
      touch --no-dereference --reference="$entry" "$top/@kaordo/$name"
    else
      cp -a --reflink=always "$entry" "$top/@kaordo/"
    fi
  done
  chown --reference="$top" "$top/@kaordo"
  touch --reference="$top" "$top/@kaordo"
  # Every file, owner, mode and time must match; any difference stops the cutover
  local differences excludes=(--exclude='/@*')
  for name in "${nested[@]}"; do excludes+=(--exclude="/$name/"); done
  differences=$(rsync -aHAXn --numeric-ids --delete --itemize-changes "${excludes[@]}" "$top/" "$top/@kaordo/")
  for name in "${nested[@]}"; do
    [[ -d "$top/$name" ]] && differences+=$(rsync -aHAXn --numeric-ids --delete --itemize-changes "$top/$name/" "$top/@kaordo/$name/")
  done
  [[ -z "$differences" ]] || die "copied data differs: $differences"
}

arm_trial() {
  local system kernel initrd params uuid
  system=$(readlink -f "$built")
  kernel=$(readlink -f "$system/kernel")
  initrd=$(readlink -f "$system/initrd")
  params=$(cat "$system/kernel-params")
  uuid=$(findmnt -n -o UUID /)
  # The old system's menu boots the new kernel from the old store, which mounts the pool
  # Appended like NixOS's own entries; the next generated menu drops it again
  sed -i "/^menuentry \"$entry\"/,/^}/d" /boot/grub/grub.cfg
  cat >> /boot/grub/grub.cfg <<EOF
menuentry "$entry" --class nixos {
search --set=drive1 --fs-uuid $uuid
  linux (\$drive1)$kernel init=$system/init $params
  initrd (\$drive1)$initrd
}
EOF
  grub-reboot "$entry"
}

cutover() {
  root_on_pool && die 'the system already runs from the pool'
  [[ -L "$built" ]] || die 'run prepare first'
  mount_top
  step 'stopping services'
  systemctl stop "${services[@]}"
  systemctl stop nix-daemon.socket nix-daemon.service
  step 'syncing the system again'
  sync_system
  patch_configuration
  step 'moving data into @kaordo'
  move_data
  sync
  arm_trial
  step "armed one trial boot; run: systemctl reboot"
  step 'if the host does not come back within ten minutes, power-cycle it to start the old system'
}

finalize() {
  root_on_pool || die 'boot the trial system first'
  local system
  system=$(readlink -f /run/current-system)
  nix-env -p /nix/var/nix/profiles/system --set "$system"
  NIXOS_INSTALL_BOOTLOADER=1 "$system/bin/switch-to-configuration" boot
  step "the pool system is the default and every pool disk carries GRUB"
}

cleanup() {
  root_on_pool || die 'finalize first'
  mount_top
  local entry name
  for entry in "$top"/* "$top"/.[!.]*; do
    [[ -e "$entry" ]] || continue
    name=$(basename "$entry")
    [[ "$name" == @* ]] && continue
    rm -rf --one-file-system "$entry"
  done
  step 'removed the pre-migration data from the top level'
}

# Sourcing defines the stages without running one, which the rehearsal on loop devices uses
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    check | prepare | cutover | finalize | cleanup) "$1" ;;
    *) die 'usage: migrate-to-pool.sh check|prepare|cutover|finalize|cleanup' ;;
  esac
fi
