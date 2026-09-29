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

export DATABASE_URL="postgres://kaordo:${KAORDO_DB_PASSWORD}@127.0.0.1:5432/kaordo?sslmode=disable"
export OIDC_ISSUER='http://localhost:8080/realms/kaordo'
export OIDC_AUDIENCE='kerno-api'
export KAORDO_ALLOWED_ORIGINS="${KAORDO_SITE_ORIGIN},http://localhost:5173"
export NODO_INTERNAL_URL='http://127.0.0.1:8082'
export NODO_PUBLIC_URL='http://127.0.0.1:8082'
export NODO_MEDIA_SIGNING_KEY

exec go run ./services/kerno/cmd/kerno
