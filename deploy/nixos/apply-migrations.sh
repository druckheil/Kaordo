#!/usr/bin/env bash
set -euo pipefail

migrations_dir=${1:-/etc/nixos/deploy/postgres}
if [[ ! -d "$migrations_dir" ]]; then
  printf 'Migration directory not found: %s\n' "$migrations_dir" >&2
  exit 1
fi

for migration in "$migrations_dir"/[0-9]*.sql; do
  if [[ ! -f "$migration" ]]; then
    printf 'No SQL migrations found in %s\n' "$migrations_dir" >&2
    exit 1
  fi
  sudo -u kaordo psql -X -v ON_ERROR_STOP=1 -d kaordo -f "$migration" >/dev/null
  printf 'Applied %s as kaordo\n' "${migration##*/}"
done
