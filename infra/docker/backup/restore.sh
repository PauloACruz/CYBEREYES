#!/bin/sh
# Restaura um conjunto de backup do WinCare (gerado por backup.sh) em um stack Docker Compose.
#
# Uso (no servidor, a partir de qualquer pasta):
#   infra/docker/backup/restore.sh [opcoes] --yes <pasta-do-conjunto>
#
# Opcoes:
#   -p, --project NOME   projeto do Compose (padrao: wincare)
#   --env-file ARQUIVO   .env do stack (padrao: infra/docker/.env)
#   --no-mesh            nao restaura os volumes do MeshCentral
#   --no-start           nao sobe o stack ao final
#   --yes                confirma que o banco e os volumes do projeto serao SOBRESCRITOS
#
# Conjuntos cifrados (*.enc) exigem BACKUP_PASSPHRASE no ambiente.
# Outros arquivos do Compose (override) podem ser passados pela variavel COMPOSE_FILE.
# Requisitos no servidor: docker com compose, sha256sum e openssl (este so para conjuntos cifrados).
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
COMPOSE_DIR=$(dirname "$SCRIPT_DIR")
PROJECT=wincare
ENV_FILE="$COMPOSE_DIR/.env"
RESTORE_MESH=1
START=1
CONFIRMED=0
SET_DIR=
DB_NAME=wincare
DB_USER=wincare
HELPER_IMAGE="${HELPER_IMAGE:-postgres:17-alpine}"
# Usuario "node" da imagem do MeshCentral: dono da raiz dos volumes, mesmo que o arquivo venha de um volume nunca usado.
MESH_UID=1000
PBKDF2_ITER=200000

log() { printf '%s [restore] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >&2; }
fail() { log "ERRO: $*"; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        -p|--project) PROJECT="$2"; shift 2 ;;
        --env-file) ENV_FILE="$2"; shift 2 ;;
        --no-mesh) RESTORE_MESH=0; shift ;;
        --no-start) START=0; shift ;;
        --yes) CONFIRMED=1; shift ;;
        -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
        -*) fail "opcao desconhecida: $1" ;;
        *) SET_DIR="$1"; shift ;;
    esac
done

[ -n "$SET_DIR" ] || fail "informe a pasta do conjunto de backup (ex.: backups/wincare-20261001-023000)"
SET_DIR=$(cd "$SET_DIR" 2>/dev/null && pwd) || fail "pasta nao encontrada: $SET_DIR"
[ -f "$SET_DIR/SHA256SUMS" ] || fail "$SET_DIR nao parece um conjunto do backup.sh (falta SHA256SUMS)"
[ -f "$ENV_FILE" ] || fail "arquivo de ambiente nao encontrado: $ENV_FILE"

[ -n "${COMPOSE_FILE:-}" ] || export COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
dc() { docker compose -p "$PROJECT" --project-directory "$COMPOSE_DIR" --env-file "$ENV_FILE" "$@"; }

encrypted=0
[ -f "$SET_DIR/postgres.dump.enc" ] && encrypted=1
if [ "$encrypted" = 1 ]; then
    [ -f "$SET_DIR/postgres.dump.enc" ] || fail "postgres.dump.enc ausente"
    [ -n "${BACKUP_PASSPHRASE:-}" ] || fail "conjunto cifrado: defina BACKUP_PASSPHRASE"
else
    [ -f "$SET_DIR/postgres.dump" ] || fail "postgres.dump ausente"
fi

if [ "$CONFIRMED" != 1 ]; then
    cat >&2 <<EOF
ATENCAO: esta restauracao vai SOBRESCREVER, no projeto Compose "$PROJECT":
  - o banco "$DB_NAME" (apagado e recriado a partir de $SET_DIR)
$( [ "$RESTORE_MESH" = 1 ] && echo "  - os volumes ${PROJECT}_mesh_data e ${PROJECT}_mesh_files (conteudo atual apagado)" )
Os servicos api, nginx, meshcentral e backup serao parados durante a restauracao.
Repita o comando com --yes para continuar.
EOF
    exit 2
fi

started=$(date +%s)
log "conjunto: $SET_DIR (cifrado: $([ "$encrypted" = 1 ] && echo sim || echo nao)), projeto: $PROJECT"

log "verificando SHA256SUMS"
(cd "$SET_DIR" && sha256sum -c --quiet SHA256SUMS) || fail "checksum nao confere; conjunto corrompido ou incompleto"

WORK=$(mktemp -d)
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Entrega o arquivo em texto claro (decifrando em $WORK quando preciso) e imprime o caminho.
plain() {
    name="$1"
    if [ -f "$SET_DIR/$name.enc" ]; then
        openssl enc -d -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -pass env:BACKUP_PASSPHRASE \
            -in "$SET_DIR/$name.enc" -out "$WORK/$name" || fail "falha ao decifrar $name (senha errada?)"
        echo "$WORK/$name"
    elif [ -f "$SET_DIR/$name" ]; then
        echo "$SET_DIR/$name"
    fi
}

dump=$(plain postgres.dump)
[ -n "$dump" ] || fail "postgres.dump nao encontrado"
mesh_data_archive=
mesh_files_archive=
if [ "$RESTORE_MESH" = 1 ]; then
    mesh_data_archive=$(plain mesh_data.tar.gz)
    mesh_files_archive=$(plain mesh_files.tar.gz)
fi

# Valida tudo antes de parar qualquer servico: senha errada ou arquivo ruim nao pode derrubar o banco atual.
log "validando o dump e os arquivos"
docker run --rm --network none -v "$(dirname "$dump"):/in:ro" "$HELPER_IMAGE" \
    pg_restore --list "/in/$(basename "$dump")" >/dev/null || fail "dump ilegivel (senha errada ou arquivo corrompido)"
for archive in $mesh_data_archive $mesh_files_archive; do
    gzip -t "$archive" || fail "arquivo ilegivel: $(basename "$archive")"
done

log "parando servicos que usam o banco e os volumes"
dc stop api nginx meshcentral backup >/dev/null 2>&1 || true

log "subindo o postgres"
dc up -d --no-build postgres >/dev/null
i=0
# Via TCP: no primeiro boot o servidor temporario do initdb responde so pelo socket local.
until dc exec -T postgres pg_isready -h 127.0.0.1 -U "$DB_USER" -d postgres >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || fail "postgres nao ficou pronto em 120 s"
    sleep 2
done

log "recriando o banco $DB_NAME"
dc exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\"" || fail "nao foi possivel recriar o banco"

log "pg_restore"
dc exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error < "$dump" \
    || fail "pg_restore falhou"
[ "$dump" = "$WORK/postgres.dump" ] && rm -f "$dump"

volume_for() {
    name=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" \
        --filter "label=com.docker.compose.volume=$1")
    if [ -z "$name" ]; then
        name="${PROJECT}_$1"
        docker volume create --label "com.docker.compose.project=$PROJECT" \
            --label "com.docker.compose.volume=$1" "$name" >/dev/null
    fi
    echo "$name"
}

if [ "$RESTORE_MESH" = 1 ]; then
    for vol in mesh_data mesh_files; do
        if [ "$vol" = mesh_data ]; then archive=$mesh_data_archive; else archive=$mesh_files_archive; fi
        if [ -z "$archive" ]; then
            log "AVISO: $vol.tar.gz nao existe no conjunto; volume mantido como esta"
            continue
        fi
        target=$(volume_for "$vol")
        log "restaurando $vol em $target"
        docker run --rm --network none -v "$target:/d" -v "$(dirname "$archive"):/in:ro" "$HELPER_IMAGE" \
            sh -c "find /d -mindepth 1 -delete && tar --numeric-owner -xzpf /in/$(basename "$archive") -C /d && chown $MESH_UID:$MESH_UID /d" \
            || fail "falha ao restaurar $vol"
    done
    # A chave de token em mesh_shared e regravada pelo MeshCentral so quando falta; apagamos para
    # que ele grave a chave que corresponde ao mesh_data restaurado.
    shared=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" \
        --filter "label=com.docker.compose.volume=mesh_shared")
    if [ -n "$shared" ]; then
        docker run --rm --network none -v "$shared:/s" "$HELPER_IMAGE" rm -f /s/mesh_token
    fi
fi

if [ -f "$SET_DIR/env" ] || [ -f "$SET_DIR/env.enc" ]; then
    log "o conjunto tem uma copia do .env; ela NAO foi aplicada (ver docs/runbooks/backup-restauracao.md)"
fi

if [ "$START" = 1 ]; then
    log "subindo o stack"
    dc up -d >/dev/null || fail "docker compose up falhou; verifique com: docker compose -p $PROJECT ps"
fi

log "concluido em $(( $(date +%s) - started ))s"
