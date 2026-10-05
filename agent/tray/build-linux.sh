#!/usr/bin/env bash
# Compila o eyes-tray do Linux: Wails com CGO, GTK 3 e WebKit2GTK 4.1 (tag gtk3), na arquitetura da maquina.
# Uso: ./build-linux.sh [pasta_de_saida]   (padrao: ../dist)
# Exige a interface compilada (npm ci && npm run build em frontend/), gcc, pkg-config,
# libgtk-3-dev e libwebkit2gtk-4.1-dev. Gera eyes-tray-v<versao>-linux-<arch>, no formato que a API distribui.
# A imagem da API compila no Debian 12 (glibc 2.36) para o binario rodar no Ubuntu 22.04 ou mais novo.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-../dist}"
VERSION="$(tr -d '[:space:]' < ../VERSION)"
ARCH="$(go env GOARCH)"
if [ ! -f frontend/dist/index.html ]; then
    echo "ERRO: compile a interface antes (npm ci && npm run build em frontend/)" >&2
    exit 1
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
name="eyes-tray-v${VERSION}-linux-${ARCH}"
echo "-> ${name}"
CGO_ENABLED=1 go build -tags gtk3 -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o "${OUT}/${name}" .
