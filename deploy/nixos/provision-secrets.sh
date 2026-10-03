#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  printf 'Run as root.\n' >&2
  exit 1
fi

umask 077
secrets=/srv/kaordo/secrets
install -d -m 0700 "$secrets"

if [[ ! -e "$secrets/keycloak-db-password" ]]; then
  openssl rand -hex 32 > "$secrets/keycloak-db-password"
fi
if [[ ! -e "$secrets/keycloak-admin.env" ]]; then
  {
    printf 'KC_BOOTSTRAP_ADMIN_USERNAME=admin\n'
    printf 'KC_BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 32)"
  } > "$secrets/keycloak-admin.env"
fi
if [[ ! -e "$secrets/media-signing-key" ]]; then
  openssl rand -hex 32 > "$secrets/media-signing-key"
fi
if [[ ! -e "$secrets/livekit-keys" ]]; then
  printf '%s: %s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 32)" > "$secrets/livekit-keys"
fi

media_key=$(<"$secrets/media-signing-key")
IFS=': ' read -r livekit_key livekit_secret < "$secrets/livekit-keys"

if [[ ! -e "$secrets/kerno.env" ]]; then
  cat > "$secrets/kerno.env" <<EOF
DATABASE_URL=postgres://kaordo@/kaordo?host=/run/postgresql
OIDC_ISSUER=https://kaordo.link/realms/kaordo
OIDC_BACKCHANNEL_URL=http://127.0.0.1:8080
OIDC_AUDIENCE=kerno-api
KAORDO_ALLOWED_ORIGINS=https://kaordo.link
NODO_INTERNAL_URL=http://127.0.0.1:8082
NODO_PUBLIC_URL=https://kaordo.link
NODO_MEDIA_SIGNING_KEY=$media_key
LIVEKIT_URL=http://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=wss://kaordo.link
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
EOF
fi

if ! grep -q '^OIDC_BACKCHANNEL_URL=' "$secrets/kerno.env"; then
  printf 'OIDC_BACKCHANNEL_URL=http://127.0.0.1:8080\n' >> "$secrets/kerno.env"
fi

if [[ ! -e "$secrets/nodo.env" ]]; then
  cat > "$secrets/nodo.env" <<EOF
KERNO_INTERNAL_URL=http://127.0.0.1:8081
NODO_DATA_DIR=/srv/kaordo/media
NODO_ALLOWED_ORIGINS=https://kaordo.link
NODO_MEDIA_SIGNING_KEY=$media_key
EOF
fi

chmod 0600 "$secrets"/*
printf 'Kaordo runtime secrets are ready in %s.\n' "$secrets"
