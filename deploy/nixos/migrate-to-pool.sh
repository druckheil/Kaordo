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
# Until finalize, the old system stays the default. Its data is the cutover copy: returning
# to it after writes on the trial system requires reconciling those writes first.
set -euo pipefail
umask 077

label=Data1
top=/mnt/kaordo-pool
built=/root/kaordo-pool-system
entry='Kaordo on the pool (trial)'
nested=(postgresql media prometheus releases)
services=(caddy kerno nodo keycloak postgresql livekit prometheus prometheus-node-exporter regado-agent ddclient.timer ddclient)
data_root=/srv/kaordo
configuration_root=/etc/nixos
boot_directory=/boot
current_system=/run/current-system
stopped=()
lock=

die() { echo "migrate-to-pool: $*" >&2; exit 1; }
step() { echo "== $*"; }

require_root() { [[ $EUID -eq 0 ]] || die 'run as root'; }

phase() { cat "$top/@migration/phase" 2>/dev/null || true; }

record_phase() {
  printf '%s\n' "$1" > "$top/@migration/.phase"
  mv -f "$top/@migration/.phase" "$top/@migration/phase"
  sync
}

finish() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "${#stopped[@]}" -gt 0 ]]; then
    echo 'Cutover failed; restarting the previously active services on the original system.' >&2
    grub-editenv "$boot_directory/grub/grubenv" unset next_entry || true
    systemctl start "${stopped[@]}" || echo 'Service recovery needs operator attention.' >&2
  fi
  [[ -z "$lock" ]] || rmdir "$lock" 2>/dev/null || true
  exit "$status"
}

mount_top() {
  mkdir -p "$top"
  mountpoint -q "$top" || mount -o subvolid=5,compress=zstd:3,noatime "/dev/disk/by-label/$label" "$top"
  [[ "$(findmnt -n -o FSROOT --mountpoint "$top")" == / &&
    "$(findmnt -n -o UUID --mountpoint "$top")" == "$(blkid -s UUID -o value "/dev/disk/by-label/$label")" ]] ||
    die 'the migration mount is not the pool top level'
}

root_on_pool() {
  [[ "$(findmnt -n -o FSTYPE /)" == btrfs && "$(findmnt -n -o FSROOT /)" == /@root &&
    "$(findmnt -n -o UUID /)" == "$(blkid -s UUID -o value "/dev/disk/by-label/$label")" ]]
}

ensure_subvolume() {
  [[ -d "$1" ]] && btrfs subvolume show "$1" >/dev/null 2>&1 && return
  [[ ! -e "$1" ]] || die "$1 exists but is not a subvolume"
  btrfs subvolume create "$1" >/dev/null
}

# Copies the system while it runs; a second pass during cutover catches what changed
sync_system() {
  rsync -aHAX --numeric-ids --delete --one-file-system \
    --exclude=/nix --exclude=/var/log --exclude=/srv --exclude=/tmp --exclude=/mnt \
    / "$top/@root/"
  mkdir -p "$top/@root/nix" "$top/@root/var/log" "$top/@root/srv/kaordo" "$top/@root/tmp" "$top/@root/mnt"
  chmod 1777 "$top/@root/tmp"
  rsync -aHAX --numeric-ids --delete /nix/ "$top/@nix/"
  rsync -aHAX --numeric-ids --delete /var/log/ "$top/@log/"
}

check() {
  require_root
  root_on_pool && die 'the system already runs from the pool'
  [[ -f "$configuration_root/deploy/nixos/storage.nix" ]] || die 'deploy a release that ships storage.nix first'
  mount_top
  [[ "$(phase)" != trial && "$(phase)" != finalized ]] || die 'a trial is already armed or finalized'
  local show
  show=$(btrfs filesystem show "$top")
  grep -q 'missing' <<<"$show" && die 'a pool device is missing'
  [[ "$(grep -c 'devid' <<<"$show")" -ge 2 ]] || die 'the pool needs two devices'
  local profiles
  profiles=$(btrfs filesystem df "$top")
  grep -q '^Data, RAID1:' <<<"$profiles" || die 'pool data is not RAID1'
  if grep -E '^(Data|Metadata|System),' <<<"$profiles" | grep -vq ', RAID1:'; then
    die 'the pool mixes profiles or has unmirrored metadata'
  fi
  btrfs device stats --check "$top" >/dev/null || die 'a pool device reports errors or could not be read'
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
  mkdir -p "$top/@migration"
  chmod 0700 "$top/@migration"
  for name in @root @nix @log @kaordo @snapshots; do ensure_subvolume "$top/$name"; done
  step 'copying the running system'
  sync_system
  patch_configuration
  step 'building the system for the pool'
  (cd /root && nixos-rebuild build -I nixos-config="$top/@root/etc/nixos/configuration.nix")
  nix-store --add-root "$built" --indirect --realise "$(readlink -f /root/result)" >/dev/null
  rm -f /root/result
  grep -q 'subvol=@root' "$built/etc/fstab" || die 'the built system does not mount @root'
  readlink -f "$built" > "$top/@migration/system"
  findmnt -n -o UUID / > "$top/@migration/original-root-uuid"
  record_phase prepared
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
  : > "$top/@migration/original-entries"
  shopt -s dotglob nullglob
  for entry in "$top"/*; do
    [[ -e "$entry" ]] || continue
    name=$(basename "$entry")
    [[ "$name" == @* ]] && continue
    printf '%s\0' "$name" >> "$top/@migration/original-entries"
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
  sed -i "/^menuentry \"$entry\"/,/^}/d" "$boot_directory/grub/grub.cfg"
  cat >> "$boot_directory/grub/grub.cfg" <<EOF
menuentry "$entry" --class nixos {
search --set=drive1 --fs-uuid $uuid
  linux (\$drive1)$kernel init=$system/init $params
  initrd (\$drive1)$initrd
}
EOF
  grub-script-check "$boot_directory/grub/grub.cfg"
  grub-reboot --boot-directory="$boot_directory" "$entry"
  grub-editenv "$boot_directory/grub/grubenv" list | grep -Fx "next_entry=$entry" >/dev/null ||
    die 'GRUB did not record the trial boot'
}

cutover() {
  check
  root_on_pool && die 'the system already runs from the pool'
  [[ -L "$built" ]] || die 'run prepare first'
  mount_top
  [[ "$(phase)" == prepared && "$(cat "$top/@migration/system")" == "$(readlink -f "$built")" ]] ||
    die 'run prepare first; its recorded system must match the trial closure'
  [[ "$(cat "$top/@migration/original-root-uuid")" == "$(findmnt -n -o UUID /)" ]] || die 'the original root changed'
  local service
  for service in "${services[@]}" nix-daemon.socket nix-daemon.service; do
    if systemctl is-active --quiet "$service"; then stopped+=("$service"); fi
  done
  step 'stopping services'
  systemctl stop "${services[@]}"
  systemctl stop nix-daemon.socket nix-daemon.service
  step 'syncing the system again'
  sync_system
  patch_configuration
  step 'moving data into @kaordo'
  move_data
  # The deployment lock is process-owned; its reflink copy must not block finalization
  if [[ -n "$lock" ]]; then rmdir "$top/@kaordo/tmp/production-deploy.lock"; fi
  sync
  arm_trial
  record_phase trial
  step "armed one trial boot; run: systemctl reboot"
  step 'if the host does not come back within ten minutes, power-cycle it to start the old system'
}

finalize() {
  root_on_pool || die 'boot the trial system first'
  mount_top
  [[ "$(phase)" == trial || "$(phase)" == finalized ]] || die 'no migration trial is recorded'
  local system
  system=$(readlink -f "$current_system")
  [[ "$system" == "$(cat "$top/@migration/system")" ]] || die 'the running system differs from the prepared trial'
  local path volume
  for path in /nix /var/log /srv/kaordo; do
    case "$path" in /nix) volume=@nix ;; /var/log) volume=@log ;; *) volume=@kaordo ;; esac
    [[ "$(findmnt -n -o FSROOT --mountpoint "$path")" == "/$volume" &&
      "$(findmnt -n -o UUID --mountpoint "$path")" == "$(findmnt -n -o UUID /)" ]] || die "$path is not on the expected pool subvolume"
  done
  for path in "${services[@]}"; do
    [[ "$path" == ddclient ]] || systemctl is-active --quiet "$path" || die "$path is not active"
  done
  for path in http://127.0.0.1:8081/healthz http://127.0.0.1:8082/healthz http://127.0.0.1:8080/realms/kaordo; do
    curl --fail --silent --max-time 10 -o /dev/null "$path" || die "service health check failed: $path"
  done
  nix-env -p /nix/var/nix/profiles/system --set "$system"
  NIXOS_INSTALL_BOOTLOADER=1 "$system/bin/switch-to-configuration" boot
  record_phase finalized
  touch /var/lib/kaordo-pool-migration-finalized
  rm -f "$built"
  step "the pool system is the default and every pool disk carries GRUB"
}

cleanup() {
  root_on_pool || die 'boot the pool system first'
  mount_top
  if [[ "$(phase)" == cleaned ]]; then step 'the original data was already retired'; return; fi
  [[ "$(phase)" == finalized ]] || die 'finalize first; trial rollback data cannot be removed'
  [[ -f "$top/@migration/original-entries" ]] || die 'the original data manifest is missing'
  local name
  while IFS= read -r -d '' name; do
    [[ -n "$name" && "$name" != @* && "$name" != . && "$name" != .. && "$name" != */* ]] || die 'invalid original data entry'
    rm -rf --one-file-system -- "${top:?}/$name"
  done < "$top/@migration/original-entries"
  record_phase cleaned
  step 'removed the pre-migration data from the top level'
}

# Sourcing defines the stages without running one, which the rehearsal on loop devices uses
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  require_root
  mkdir -p "$data_root/tmp"
  lock="$data_root/tmp/production-deploy.lock"
  mkdir "$lock" 2>/dev/null || die 'another production deployment or migration is running'
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  case "${1:-}" in
    check | prepare | cutover | finalize | cleanup) "$1" ;;
    *) die 'usage: migrate-to-pool.sh check|prepare|cutover|finalize|cleanup' ;;
  esac
fi
