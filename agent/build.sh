#!/usr/bin/env bash
# Compila o EYES para todas as plataformas suportadas.
# Uso: ./build.sh [pasta_de_saida]   (padrao: dist/)
# Gera eyes-v<versao>-<plat>-<arch>[.exe] e o arquivo VERSION, no formato que a API distribui.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-dist}"
VERSION="$(tr -d '[:space:]' < VERSION)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
TARGETS=(
    windows/amd64 windows/386 windows/arm64
    linux/amd64 linux/386 linux/arm64 linux/arm
    darwin/amd64 darwin/arm64
)
for t in "${TARGETS[@]}"; do
    os="${t%/*}"; arch="${t#*/}"
    ext=""; [ "$os" = windows ] && ext=".exe"
    name="eyes-v${VERSION}-${os}-${arch}${ext}"
    echo "-> ${name}"
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" GOARM=6 go build -trimpath \
        -ldflags "-s -w -X github.com/pauloacruz/cybereyes/agent/internal/version.Version=${VERSION}" \
        -o "${OUT}/${name}" ./cmd/eyes
done
# App de bandeja (eyes-tray) do Windows: Wails sem CGO, com o frontend ja compilado em tray/frontend/dist.
# O do Linux precisa de CGO e das bibliotecas GTK/WebKitGTK: tray/build-linux.sh (estagio proprio no Dockerfile).
if [ -f tray/frontend/dist/index.html ]; then
    for arch in amd64 386 arm64; do
        name="eyes-tray-v${VERSION}-windows-${arch}.exe"
        echo "-> ${name}"
        (cd tray && CGO_ENABLED=0 GOOS=windows GOARCH="$arch" go build -trimpath \
            -ldflags "-H=windowsgui -s -w -X main.version=${VERSION}" -o "${OUT}/${name}" .)
    done
else
    echo "(eyes-tray ignorado: rode npm ci && npm run build em tray/frontend)"
fi
printf '%s\n' "$VERSION" > "${OUT}/VERSION"
