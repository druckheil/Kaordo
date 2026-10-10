#!/usr/bin/env bash
# Applies one verified frontend, backend and configuration snapshot with coordinated rollback
set -euo pipefail

release_id=${1:?release ID required}
expected_hash=${2:?archive checksum required}
origin_host=${3:?public hostname required}
auth_realm=${4:?identity realm required}
archive=${5:?release archive required}
expected_revision=${6:-}

if [[ ! "$release_id" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z(-dirty)?$ ]]; then
  echo 'invalid release ID' >&2
  exit 2
fi
if [[ -n "$expected_revision" && ! "$expected_revision" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'invalid source revision' >&2
  exit 2
fi
if [[ ! "$expected_hash" =~ ^[a-f0-9]{64}$ || ! "$origin_host" =~ ^[A-Za-z0-9.-]+$ || ! "$auth_realm" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo 'invalid release verification parameters' >&2
  exit 2
fi
if [[ "$archive" != "/tmp/kaordo-$release_id-full.tar.gz" ]]; then
  echo 'invalid release archive path' >&2
  exit 2
fi

data_root=/srv/kaordo
temporary_root="$data_root/tmp"
release_root="$data_root/releases/$release_id-full"
backup_root="$data_root/rollbacks/$release_id-full"
staging="$temporary_root/$release_id-full"
lock="$temporary_root/production-deploy.lock"
origin="https://$origin_host"
source_mutated=0
binaries_mutated=0
site_mutated=0
identity_mutated=0
system_switch_started=0
node_runtime=
previous_system=
previous_site=
previous_release=
services=(caddy keycloak postgresql livekit kerno nodo regado-agent prometheus prometheus-node-exporter ddclient.timer)

mkdir -p "$temporary_root" "$data_root/releases" "$data_root/rollbacks"
if ! mkdir "$lock" 2>/dev/null; then
  echo 'another production deployment is already running' >&2
  exit 1
fi

wait_for_http() {
  local url=$1 max_attempts=${2:-40} attempt=0
  while [[ "$attempt" -lt "$max_attempts" ]]; do
    if curl --fail --silent --max-time 3 -o /dev/null "$url"; then return 0; fi
    sleep 1
    attempt=$((attempt + 1))
  done
  printf 'service did not become ready: %s\n' "$url" >&2
  return 1
}

check_services() {
  local service
  for service in "${services[@]}"; do
    systemctl is-active --quiet "$service" || {
      printf 'required service is not active: %s\n' "$service" >&2
      return 1
    }
  done
  [[ -S /run/regado-agent/agent.sock ]] || {
    echo 'Regado agent socket is missing' >&2
    return 1
  }
}

backup_source() {
  local source=$1 destination=$2
  mkdir -p "$(dirname "$destination")"
  if [[ -e "$source" || -L "$source" ]]; then cp -a "$source" "$destination";
  else touch "$destination.absent"; fi
}

restore_source() {
  local source=$1 backup=$2
  rm -rf "$source"
  if [[ ! -e "$backup.absent" ]]; then
    mkdir -p "$(dirname "$source")"
    cp -a "$backup" "$source"
  fi
}

restore_release() {
  local status=$? rollback_failed=0
  trap - EXIT
  set +e
  if [[ "$status" -ne 0 && "$source_mutated" -eq 1 ]]; then
    echo 'Release failed; restoring the previous applications, configuration and identity policy.' >&2
    if [[ "$site_mutated" -eq 1 ]]; then
      ln -s "$previous_site" "$data_root/www/.rollback-$release_id" &&
        mv -Tf "$data_root/www/.rollback-$release_id" "$data_root/www/current" || rollback_failed=1
      if [[ -n "$previous_release" ]]; then
        ln -s "$previous_release" "$data_root/releases/.rollback-$release_id" &&
          mv -Tf "$data_root/releases/.rollback-$release_id" "$data_root/releases/current" || rollback_failed=1
      else rm -f "$data_root/releases/current"; fi
    fi
    systemctl stop kerno nodo regado-agent || rollback_failed=1
    if [[ "$binaries_mutated" -eq 1 ]]; then
      for binary in kerno nodo regado-agent; do
        cp -a "$backup_root/bin/$binary" "$data_root/bin/.$binary-rollback" &&
          mv -f "$data_root/bin/.$binary-rollback" "$data_root/bin/$binary" || rollback_failed=1
      done
    fi
    for path in deploy/nixos deploy/keycloak scripts/sync-keycloak.mjs; do
      restore_source "/etc/nixos/$path" "$backup_root/etc-nixos/$path" || rollback_failed=1
    done
    if [[ "$system_switch_started" -eq 1 || "$(readlink -f /run/current-system)" != "$previous_system" ]]; then
      nixos-rebuild switch --store-path "$previous_system" || rollback_failed=1
    fi
    if [[ "$identity_mutated" -eq 1 ]]; then
      wait_for_http http://127.0.0.1:8080/realms/master 120 &&
        "$node_runtime" "$release_root/etc/nixos/deploy/nixos/sync-keycloak-production.mjs" --restore "$backup_root/keycloak.json" || rollback_failed=1
    fi
    systemctl start regado-agent nodo kerno || rollback_failed=1
    wait_for_http http://127.0.0.1:8081/healthz &&
      wait_for_http http://127.0.0.1:8082/healthz && check_services || rollback_failed=1
    # Exit code 70 tells automatic deployment that production may be inconsistent and it must halt
    if [[ "$rollback_failed" -eq 1 ]]; then
      echo 'Rollback needs operator attention; inspect the deployment log.' >&2
      status=70
    else echo 'Previous release restored; forward-only database migrations are retained.' >&2; fi
  elif [[ "$status" -ne 0 ]]; then
    echo 'Release failed before changing the host.' >&2
  fi
  rm -rf "$staging"
  rm -f "$archive"
  rmdir "$lock" 2>/dev/null || true
  exit "$status"
}
trap restore_release EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

if [[ -e "$release_root" || -e "$backup_root" ]]; then
  echo 'release or rollback directory already exists' >&2
  exit 1
fi
check_services
wait_for_http http://127.0.0.1:8081/healthz
wait_for_http http://127.0.0.1:8082/healthz
wait_for_http http://127.0.0.1:8080/realms/master 120
[[ -L "$data_root/www/current" && -d "$data_root/www/current" ]]
previous_site=$(readlink "$data_root/www/current")
previous_release=$(readlink "$data_root/releases/current" 2>/dev/null || true)
previous_system=$(readlink -f /run/current-system)
curl --location --fail --silent --show-error --max-time 15 \
  --resolve "$origin_host:443:127.0.0.1" "$origin/realms/$auth_realm/.well-known/openid-configuration" -o /dev/null

actual_hash=$(sha256sum "$archive" | cut -d' ' -f1)
if [[ "$actual_hash" != "$expected_hash" ]]; then
  echo 'uploaded release checksum does not match' >&2
  exit 1
fi
if tar -tzf "$archive" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
  echo 'release archive contains an unsafe path' >&2
  exit 1
fi
if tar -tvzf "$archive" | grep -E '^[^d-]' >/dev/null; then
  echo 'release archive contains a link or special file' >&2
  exit 1
fi
mkdir "$staging"
tar -xzf "$archive" -C "$staging" --no-same-owner
if [[ -n "$expected_revision" ]]; then
  node --input-type=module - "$staging/manifest.json" "$expected_revision" <<'JS'
import {readFileSync} from 'node:fs';
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (manifest.sourceCommit !== process.argv[3] || manifest.workingTreeDirty !== false)
  throw new Error('Release must match the tested clean source revision.');
JS
fi
for path in bin/kerno bin/nodo bin/regado-agent manifest.json site/index.html \
  etc/nixos/deploy/nixos/kaordo.nix etc/nixos/deploy/nixos/verify-release.mjs \
  etc/nixos/deploy/nixos/sync-keycloak-production.mjs etc/nixos/scripts/sync-keycloak.mjs; do
  [[ -s "$staging/$path" ]] || { printf 'release is missing %s\n' "$path" >&2; exit 1; }
done

# Read-only snapshots of the databases and uploads let an operator undo this release's data
# changes. They share unchanged blocks with the live data; the newest three are kept
snapshot="$data_root/snapshots/$(date -u +%Y%m%dT%H%M%SZ)-$release_id"
mkdir -p "$snapshot"
for volume in postgresql media; do
  btrfs subvolume snapshot -r "$data_root/$volume" "$snapshot/$volume" >/dev/null
done
for old in $(find "$data_root/snapshots" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +4); do
  btrfs subvolume delete "$old"/* >/dev/null
  rmdir "$old"
done

mv "$staging" "$release_root"
chmod 0755 "$data_root/releases" "$release_root"
mkdir -m 0700 "$backup_root"
mkdir "$backup_root/bin"
for binary in kerno nodo regado-agent; do cp -a "$data_root/bin/$binary" "$backup_root/bin/$binary"; done
printf '%s\n' "$previous_system" > "$backup_root/nixos-system"
printf '%s\n' "$previous_site" > "$backup_root/site-target"
for path in deploy/nixos deploy/keycloak scripts/sync-keycloak.mjs; do
  backup_source "/etc/nixos/$path" "$backup_root/etc-nixos/$path"
done

source_mutated=1
for path in deploy/nixos deploy/keycloak; do
  rm -rf "/etc/nixos/$path"
  mkdir -p "$(dirname "/etc/nixos/$path")"
  cp -a "$release_root/etc/nixos/$path" "/etc/nixos/$path"
done
mkdir -p /etc/nixos/scripts
cp -a "$release_root/etc/nixos/scripts/sync-keycloak.mjs" /etc/nixos/scripts/sync-keycloak.mjs

(cd "$release_root" && nixos-rebuild build)
mv "$release_root/result" "$release_root/nixos-system"
node_runtime="$release_root/nixos-system/sw/bin/node"
[[ -x "$node_runtime" ]]
"$node_runtime" "$release_root/etc/nixos/deploy/nixos/verify-release.mjs" payload "$release_root" "$release_id" "$origin" "$auth_realm"
"$node_runtime" "$release_root/etc/nixos/deploy/nixos/sync-keycloak-production.mjs" --snapshot "$backup_root/keycloak.json"

for binary in kerno nodo regado-agent; do
  install -o root -g root -m 0755 "$release_root/bin/$binary" "$data_root/bin/.$binary-new"
done
binaries_mutated=1
for binary in kerno nodo regado-agent; do mv -f "$data_root/bin/.$binary-new" "$data_root/bin/$binary"; done
system_switch_started=1
nixos-rebuild switch --store-path "$(readlink -f "$release_root/nixos-system")"
[[ "$(readlink -f /run/current-system)" == "$(readlink -f "$release_root/nixos-system")" ]]
systemctl restart regado-agent
systemctl restart nodo
systemctl restart kerno
wait_for_http http://127.0.0.1:8080/realms/master 120
identity_mutated=1
"$node_runtime" /etc/nixos/deploy/nixos/sync-keycloak-production.mjs
wait_for_http http://127.0.0.1:8081/healthz
wait_for_http http://127.0.0.1:8082/healthz
check_services
for binary in kerno nodo regado-agent; do
  pid=$(systemctl show "$binary" -p MainPID --value)
  [[ "$pid" -gt 0 ]]
  [[ "$(sha256sum "/proc/$pid/exe" | cut -d' ' -f1)" == "$(sha256sum "$data_root/bin/$binary" | cut -d' ' -f1)" ]]
done

chmod -R a+rX "$release_root/site"
site_mutated=1
ln -s "../releases/$release_id-full/site" "$data_root/www/.current-$release_id"
mv -Tf "$data_root/www/.current-$release_id" "$data_root/www/current"
ln -s "$release_id-full" "$data_root/releases/.current-$release_id"
mv -Tf "$data_root/releases/.current-$release_id" "$data_root/releases/current"
"$node_runtime" /etc/nixos/deploy/nixos/verify-release.mjs live "$release_root" "$release_id" "$origin" "$auth_realm"

source_mutated=0
binaries_mutated=0
site_mutated=0
identity_mutated=0
rm -f "$archive"
printf 'active_full_release=%s\nprevious_nixos_system=%s\n' "$release_root" "$previous_system"
sha256sum "$data_root/bin/kerno" "$data_root/bin/nodo" "$data_root/bin/regado-agent"
