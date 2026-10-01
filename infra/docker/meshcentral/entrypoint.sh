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

exec node node_modules/meshcentral
