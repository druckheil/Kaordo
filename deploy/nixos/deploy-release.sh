#!/usr/bin/env bash
# Applies a checksummed full release with source and service rollback
set -euo pipefail

release_id=${1:?release ID required}
expected_hash=${2:?archive checksum required}
origin_host=${3:?public hostname required}
auth_realm=${4:?identity realm required}
archive=${5:?release archive required}

if [[ ! "$release_id" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z(-dirty)?$ ]]; then
  echo 'invalid release ID' >&2
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
lock="$temporary_root/full-deploy.lock"
origin="https://$origin_host"
source_mutated=0
binaries_mutated=0
node_runtime=
previous_system=

mkdir -p "$temporary_root" "$data_root/releases" "$data_root/rollbacks"
if ! mkdir "$lock" 2>/dev/null; then
  echo 'another full production deployment is already running' >&2
  exit 1
fi

wait_for_http() {
  local url=$1
  local max_attempts=${2:-40}
  local attempt=0
  while [[ "$attempt" -lt "$max_attempts" ]]; do
    if curl --fail --silent --max-time 3 -o /dev/null "$url"; then return 0; fi
    sleep 1
    attempt=$((attempt + 1))
  done
  printf 'service did not become ready: %s\n' "$url" >&2
  return 1
}

backup_source() {
  local source=$1
  local destination=$2
  mkdir -p "$(dirname "$destination")"
  if [[ -e "$source" || -L "$source" ]]; then
    cp -a "$source" "$destination"
  else
    touch "$destination.absent"
  fi
}

restore_source() {
  local source=$1
  local backup=$2
  rm -rf "$source"
  if [[ ! -e "$backup.absent" ]]; then
    mkdir -p "$(dirname "$source")"
    cp -a "$backup" "$source"
  fi
}

restore_release() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "$status" -ne 0 ]]; then
    if [[ "$binaries_mutated" -eq 1 || "$source_mutated" -eq 1 ]]; then
      echo 'Full release failed; restoring the previous NixOS configuration and backend binaries.' >&2
      systemctl stop kerno.service nodo.service regado-agent.service
      if [[ "$binaries_mutated" -eq 1 ]]; then
        for binary in kerno nodo regado-agent; do
          cp -a "$backup_root/bin/$binary" "/srv/kaordo/bin/.$binary-rollback"
          mv -f "/srv/kaordo/bin/.$binary-rollback" "/srv/kaordo/bin/$binary"
        done
      fi
      if [[ "$source_mutated" -eq 1 ]]; then
        restore_source /etc/nixos/deploy/nixos "$backup_root/etc-nixos/deploy/nixos"
        restore_source /etc/nixos/deploy/postgres "$backup_root/etc-nixos/deploy/postgres"
        restore_source /etc/nixos/deploy/keycloak "$backup_root/etc-nixos/deploy/keycloak"
        restore_source /etc/nixos/scripts/sync-keycloak.mjs "$backup_root/etc-nixos/scripts/sync-keycloak.mjs"
      fi
      if [[ -n "$previous_system" && "$(readlink -f /run/current-system 2>/dev/null)" != "$previous_system" ]]; then
        nixos-rebuild switch --rollback
      fi
      if [[ -n "$node_runtime" && -x "$node_runtime" ]]; then
        wait_for_http http://127.0.0.1:8080/realms/master 120 || true
        "$node_runtime" /etc/nixos/deploy/nixos/sync-keycloak-production.mjs || true
      fi
      systemctl restart kaordo-system-volumes.service || true
      systemctl start regado-agent.service || true
      systemctl start nodo.service || true
      systemctl start kerno.service || true
      wait_for_http http://127.0.0.1:8081/healthz || true
      wait_for_http http://127.0.0.1:8082/healthz || true
      echo 'Rollback attempt finished; inspect systemctl and the deployment log.' >&2
    else
      echo 'Full release failed before changing the host; no rollback was needed.' >&2
    fi
  fi
  rm -rf "$staging"
  rm -f "$archive"
  rmdir "$lock" 2>/dev/null || true
  exit "$status"
}
trap restore_release EXIT

if [[ -e "$release_root" || -e "$backup_root" ]]; then
  echo 'release or rollback directory already exists' >&2
  exit 1
fi
for service in caddy keycloak postgresql kerno nodo regado-agent kaordo-system-volumes; do
  systemctl is-active --quiet "$service.service" || {
    printf 'required service is not active: %s\n' "$service" >&2
    exit 1
  }
done
wait_for_http http://127.0.0.1:8081/healthz
wait_for_http http://127.0.0.1:8082/healthz
wait_for_http http://127.0.0.1:8080/realms/master 120
[[ -S /run/regado-agent/agent.sock ]] || {
  echo 'Regado agent socket is missing before deployment' >&2
  exit 1
}
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

mkdir "$staging"
tar -xzf "$archive" -C "$staging" --no-same-owner
for path in bin/kerno bin/nodo bin/regado-agent etc/nixos/deploy/nixos/kaordo.nix \
  etc/nixos/deploy/postgres/013_fluo_saved_post_counts.sql \
  etc/nixos/deploy/keycloak/registration-profile.json \
  etc/nixos/scripts/sync-keycloak.mjs; do
  [[ -s "$staging/$path" ]] || {
    printf 'release is missing required file: %s\n' "$path" >&2
    exit 1
  }
done

mkdir "$release_root" "$backup_root"
mkdir -p "$release_root/bin" "$backup_root/bin"
for binary in kerno nodo regado-agent; do
  install -o root -g root -m 0755 "$staging/bin/$binary" "$release_root/bin/$binary"
  cp -a "/srv/kaordo/bin/$binary" "$backup_root/bin/$binary"
done
previous_system=$(readlink -f /run/current-system)
printf '%s\n' "$previous_system" > "$backup_root/nixos-system"
backup_source /etc/nixos/deploy/nixos "$backup_root/etc-nixos/deploy/nixos"
backup_source /etc/nixos/deploy/postgres "$backup_root/etc-nixos/deploy/postgres"
backup_source /etc/nixos/deploy/keycloak "$backup_root/etc-nixos/deploy/keycloak"
backup_source /etc/nixos/scripts/sync-keycloak.mjs "$backup_root/etc-nixos/scripts/sync-keycloak.mjs"

source_mutated=1
for path in deploy/nixos deploy/postgres deploy/keycloak; do
  rm -rf "/etc/nixos/$path"
  mkdir -p "$(dirname "/etc/nixos/$path")"
  cp -a "$staging/etc/nixos/$path" "/etc/nixos/$path"
done
rm -f /etc/nixos/scripts/sync-keycloak.mjs
mkdir -p /etc/nixos/scripts
cp -a "$staging/etc/nixos/scripts/sync-keycloak.mjs" /etc/nixos/scripts/sync-keycloak.mjs

nixos-rebuild build --out-link "$release_root/nixos-system"
bash /etc/nixos/deploy/nixos/apply-migrations.sh /etc/nixos/deploy/postgres

for binary in kerno nodo regado-agent; do
  install -o root -g root -m 0755 "$release_root/bin/$binary" "/srv/kaordo/bin/.$binary-new"
done
binaries_mutated=1
for binary in kerno nodo regado-agent; do
  mv -f "/srv/kaordo/bin/.$binary-new" "/srv/kaordo/bin/$binary"
done

nixos-rebuild switch
node_runtime=$(readlink -f "$(command -v node)")
systemctl restart kaordo-system-volumes.service
systemctl restart regado-agent.service
systemctl restart nodo.service
systemctl restart kerno.service
wait_for_http http://127.0.0.1:8080/realms/master 120
"$node_runtime" /etc/nixos/deploy/nixos/sync-keycloak-production.mjs

for service in caddy keycloak postgresql kerno nodo regado-agent kaordo-system-volumes; do
  systemctl is-active --quiet "$service.service" || {
    printf 'service failed after deployment: %s\n' "$service" >&2
    exit 1
  }
done
[[ -S /run/regado-agent/agent.sock ]] || {
  echo 'Regado agent socket is missing after deployment' >&2
  exit 1
}
wait_for_http http://127.0.0.1:8081/healthz
wait_for_http http://127.0.0.1:8082/healthz
curl --location --fail --silent --show-error --max-time 15 \
  --resolve "$origin_host:443:127.0.0.1" "$origin/realms/$auth_realm/.well-known/openid-configuration" -o /dev/null
thread_status=$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' \
  --resolve "$origin_host:443:127.0.0.1" "$origin/v1/fluo/posts/01a10fd2-692b-7966-be35-037f86108801/thread")
if [[ "$thread_status" != 401 ]]; then
  printf 'Fluo thread route returned HTTP %s without a token; expected 401.\n' "$thread_status" >&2
  exit 1
fi

source_commit=$(sed -n 's/^Source commit: //p' "$staging/RELEASE.txt")
printf 'source_commit=%s\nrelease=%s\nthread_route_without_token=%s\n' \
  "$source_commit" "$release_id" "$thread_status" \
  > "$release_root/RELEASE.txt"
source_mutated=0
binaries_mutated=0
trap - EXIT
rm -rf "$staging"
rm -f "$archive"
rmdir "$lock"
printf 'active_backend_release=%s\nprevious_nixos_system=%s\n' "$release_root" "$previous_system"
sha256sum /srv/kaordo/bin/kerno /srv/kaordo/bin/nodo /srv/kaordo/bin/regado-agent
