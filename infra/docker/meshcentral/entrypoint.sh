#!/usr/bin/env bash
set -euo pipefail

: "${MESH_HOST:?MESH_HOST obrigatorio}"
: "${PROXY_IP:?PROXY_IP obrigatorio}"
DATA=/opt/meshcentral/meshcentral-data
mkdir -p "$DATA"

cat > "$DATA/config.json" <<JSON
{
  "settings": {
    "cert": "${MESH_HOST}",
    "tlsOffload": "${PROXY_IP}",
    "WANonly": true,
    "port": 4443,
    "aliasPort": 443,
    "agentAliasPort": 443,
    "redirPort": 8080,
    "allowLoginToken": true,
    "allowFraming": true,
    "agentPing": 35,
    "allowHighQualityDesktop": true,
    "maxInvalidLogin": { "time": 5, "count": 5, "coolofftime": 30 }
  },
  "domains": {
    "": {
      "title": "WinCare",
      "newAccounts": false,
      "certUrl": "https://${MESH_HOST}:443"
    }
  }
}
JSON

SHARED=/opt/meshcentral/shared
MESH_USER="${MESH_USER:-wincare}"
mkdir -p "$SHARED"

if [ ! -f "$DATA/.wincare-admin" ]; then
  pass="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  node node_modules/meshcentral --createaccount "$MESH_USER" --pass "$pass" --email "${MESH_EMAIL:-wincare@localhost}"
  node node_modules/meshcentral --adminaccount "$MESH_USER"
  touch "$DATA/.wincare-admin"
fi

if [ ! -s "$SHARED/mesh_token" ]; then
  token="$(node node_modules/meshcentral --logintokenkey | tr -d '[:space:]')"
  if [ "${#token}" -ne 160 ]; then
    echo "Falha ao gerar a chave de token do MeshCentral" >&2
    exit 1
  fi
  umask 022
  printf '%s' "$token" > "$SHARED/mesh_token.tmp"
  mv "$SHARED/mesh_token.tmp" "$SHARED/mesh_token"
fi

exec node node_modules/meshcentral
