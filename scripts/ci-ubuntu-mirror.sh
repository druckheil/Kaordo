#!/usr/bin/env bash
# Selects official Ubuntu archives while preserving signed APT suites and components
set -euo pipefail

sources_path=${1:-/etc/apt/sources.list.d/ubuntu.sources}
temporary_sources=$(mktemp)
trap 'rm -f "$temporary_sources"' EXIT
sed -E \
  -e 's|https?://azure\.archive\.ubuntu\.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
  -e 's|mirror\+file:/etc/apt/apt-mirrors\.txt|https://archive.ubuntu.com/ubuntu|g' \
  -e 's|mirror\+file:/etc/apt/apt-security-mirrors\.txt|https://security.ubuntu.com/ubuntu|g' \
  "$sources_path" > "$temporary_sources"

if grep -Eq 'azure\.archive\.ubuntu\.com|mirror\+file:' "$temporary_sources"; then
  echo 'Ubuntu source selection still includes a runner mirror; inspect the runner image configuration.' >&2
  exit 1
fi
grep -Fq 'https://archive.ubuntu.com/ubuntu' "$temporary_sources"
cat "$temporary_sources" > "$sources_path"
grep '^URIs:' "$sources_path"
