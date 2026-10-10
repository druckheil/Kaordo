#!/usr/bin/env bash
# Builds a tested main revision without access to production data or credentials
set -euo pipefail
umask 077

request=${1:?source and active revision required}
if [[ ! "$request" =~ ^([a-f0-9]{40})-([a-f0-9]{40})$ ]]; then
  echo 'invalid build request' >&2
  exit 2
fi
revision=${BASH_REMATCH[1]}
previous=${BASH_REMATCH[2]}
build_root=/srv/kaordo/cd-build
source="$build_root/source"
mkdir -p "$build_root/tools" "$build_root/candidate"
exec 9>"$build_root/build.lock"
flock -n 9 || { echo 'another isolated release build is running' >&2; exit 1; }
export PATH="$build_root/tools:$PATH"
export COREPACK_HOME="$build_root/cache/corepack"
export GOCACHE="$build_root/cache/go-build"
export GOMODCACHE="$build_root/cache/go-modules"
export GOTOOLCHAIN=auto
export GOMAXPROCS=2
export GOFLAGS='-mod=readonly -p=2'
export GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0

corepack enable --install-directory "$build_root/tools"
if [[ ! -d "$source/.git" ]]; then
  git clone --no-checkout https://github.com/druckheil/Kaordo.git "$source"
fi
git -C "$source" fetch --prune origin '+refs/heads/main:refs/remotes/origin/main'
[[ "$(git -C "$source" rev-parse refs/remotes/origin/main)" == "$revision" ]] || {
  echo 'main advanced before the build; waiting for its checks' >&2
  exit 1
}
git -C "$source" merge-base --is-ancestor "$previous" "$revision" || {
  echo 'automatic deployment cannot discard the active production history' >&2
  exit 1
}
if [[ -n "$(git -C "$source" diff --name-only --diff-filter=DMRTUXB "$previous" "$revision" -- services/kerno/internal/postgres/migrations)" ]]; then
  echo 'an applied migration was changed or removed; automatic deployment refused' >&2
  exit 1
fi
git -C "$source" reset --hard
git -C "$source" clean -ffd
git -C "$source" checkout --detach "$revision"
rm -rf "$build_root/candidate"
cd "$source"
pnpm install --frozen-lockfile
node scripts/deploy-production.mjs --build-only "$build_root/candidate"
