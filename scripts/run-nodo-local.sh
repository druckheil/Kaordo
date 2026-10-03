#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f deploy/local/.env ]]; then
  echo 'Create deploy/local/.env from deploy/local/.env.example first.' >&2
  exit 1
fi

set -a
source deploy/local/.env
set +a

export KERNO_INTERNAL_URL='http://127.0.0.1:8081'
export NODO_DATA_DIR="$PWD/deploy/local/media"
export NODO_ALLOWED_ORIGINS="${KAORDO_SITE_ORIGIN},http://localhost:5173,http://localhost:5175"
export NODO_MEDIA_SIGNING_KEY

exec go run ./services/nodo/cmd/nodo
