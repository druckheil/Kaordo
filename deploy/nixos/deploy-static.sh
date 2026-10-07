#!/usr/bin/env bash
# Verifies and atomically switches a static release, restoring the previous site on failure
set -euo pipefail

release_id=${1:?release id required}
expected_hash=${2:?archive hash required}
origin_host=${3:?public hostname required}
auth_realm=${4:?Keycloak realm required}
archive=${5:?release archive required}
source_commit=${6:?source commit required}

if [[ ! "$release_id" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[a-zA-Z0-9-]+-pages-[0-9TZ-]+(-dirty)?$ ]]; then
  echo 'invalid release id' >&2
  exit 2
fi
if [[ ! "$expected_hash" =~ ^[a-f0-9]{64}$ || ! "$source_commit" =~ ^[a-f0-9]{40}$ || ! "$origin_host" =~ ^[A-Za-z0-9.-]+$ || ! "$auth_realm" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo 'invalid release verification parameters' >&2
  exit 2
fi

web_root=/srv/kaordo/www
release_root="$web_root/releases/$release_id"
temporary_root=/srv/kaordo/tmp
lock="$temporary_root/production-deploy.lock"
metadata_root=/srv/kaordo/releases
rollback_root=/srv/kaordo/rollbacks
previous_target=

mkdir -p "$temporary_root" "$metadata_root" "$rollback_root"
if ! mkdir "$lock" 2>/dev/null; then
  echo 'another static deployment is already running' >&2
  exit 1
fi

restore_on_failure() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && -n "$previous_target" && "$(readlink "$web_root/current" 2>/dev/null || true)" == "releases/$release_id" ]]; then
    ln -s "$previous_target" "$web_root/.rollback-$release_id"
    mv -Tf "$web_root/.rollback-$release_id" "$web_root/current"
    printf 'Deployment checks failed; restored %s\n' "$previous_target" >&2
  fi
  rmdir "$lock" 2>/dev/null || true
  exit "$status"
}
trap restore_on_failure EXIT

if [[ ! -s /srv/kaordo/releases/current/RELEASE.txt ]] ||
  [[ "$(sed -n 's/^Source commit: //p' /srv/kaordo/releases/current/RELEASE.txt)" != "$source_commit" ]]; then
  echo 'Backend/configuration release differs from this frontend. Run deploy:production first.' >&2
  exit 1
fi

if [[ ! -L "$web_root/current" ]]; then
  echo 'current site is not a release symlink' >&2
  exit 1
fi
previous_target=$(readlink "$web_root/current")
if [[ ( "$previous_target" != releases/* && "$previous_target" != ../releases/*-full/site ) || ! -d "$web_root/$previous_target" ]]; then
  echo 'current site does not point to a valid release' >&2
  exit 1
fi
if [[ -e "$release_root" ]]; then
  echo "release already exists: $release_id" >&2
  exit 1
fi

for service in caddy kerno nodo regado-agent; do
  systemctl is-active --quiet "$service.service" || {
    echo "required service is not active: $service" >&2
    exit 1
  }
done
curl --fail --silent --show-error --max-time 10 -o /dev/null http://127.0.0.1:8081/healthz
curl --fail --silent --show-error --max-time 10 -o /dev/null http://127.0.0.1:8082/healthz

resolve_args=(--resolve "$origin_host:443:127.0.0.1")
origin="https://$origin_host"
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/realms/$auth_realm/.well-known/openid-configuration" -o /dev/null
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/realms/$auth_realm/protocol/openid-connect/login-status-iframe.html" -o /dev/null
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/realms/$auth_realm/protocol/openid-connect/3p-cookies/step1.html" -o /dev/null

actual_hash=$(sha256sum "$archive" | cut -d' ' -f1)
if [[ "$actual_hash" != "$expected_hash" ]]; then
  echo 'uploaded archive checksum does not match' >&2
  exit 1
fi

staging="$temporary_root/$release_id"
mkdir "$staging"
tar -xzf "$archive" -C "$staging" --no-same-owner
site="$staging/site"
if [[ ! -s "$site/index.html" || ! -s "$site/silent-check-sso.html" ]]; then
  echo 'static release is incomplete' >&2
  exit 1
fi
for app in fluo ligo rondo lingvo regado; do
  [[ -s "$site/$app/index.html" ]] || { printf 'static release is missing %s\n' "$app" >&2; exit 1; }
done
if grep -R -E -q --include='*.js' 'http://localhost:8080|http://localhost:8081|http://127\.0\.0\.1:8082' "$site"; then
  echo 'static release contains local service URLs' >&2
  exit 1
fi
if ! grep -R -F -q --include='*.js' "$origin" "$site"; then
  echo 'static release does not contain the configured public origin' >&2
  exit 1
fi

chmod -R a+rX "$site"
mv "$site" "$release_root"
install -m 0644 "$staging/RELEASE.txt" "$metadata_root/$release_id-frontend-RELEASE.txt"
printf '%s\n' "$previous_target" > "$rollback_root/$release_id-site-target"
ln -s "releases/$release_id" "$web_root/.current-$release_id"
mv -Tf "$web_root/.current-$release_id" "$web_root/current"

response="$temporary_root/$release_id-response.html"
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/" -o "$response"
cmp -s "$response" "$web_root/current/index.html"
for app in fluo ligo rondo lingvo regado; do
  curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/$app/" -o "$response"
  cmp -s "$response" "$web_root/current/$app/index.html"
done
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/silent-check-sso.html" -o /dev/null
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/realms/$auth_realm/.well-known/openid-configuration" -o /dev/null
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/realms/$auth_realm/protocol/openid-connect/login-status-iframe.html" -o /dev/null
curl --location --fail --silent --show-error --max-time 10 "${resolve_args[@]}" "$origin/realms/$auth_realm/protocol/openid-connect/3p-cookies/step1.html" -o /dev/null
curl --fail --silent --show-error --max-time 10 -o /dev/null http://127.0.0.1:8081/healthz
curl --fail --silent --show-error --max-time 10 -o /dev/null http://127.0.0.1:8082/healthz

rm -f "$response" "$archive"
rm -rf -- "$staging"
printf 'active_release=%s\nprevious_release=%s\n' "$(readlink "$web_root/current")" "$previous_target"
