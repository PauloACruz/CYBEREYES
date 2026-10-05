#!/bin/sh
# Backup do Cybereyes: PostgreSQL (pg_dump -Fc) e, opcionalmente, o .env.
#
# Uso (dentro do conteiner "backup", que ja tem as variaveis e os volumes montados):
#   backup.sh            executa um backup agora
#   backup.sh --daemon   executa todo dia no horario BACKUP_TIME (HH:MM, fuso TZ)
#
# Variaveis:
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE  conexao com o PostgreSQL
#   BACKUP_DIR          destino (padrao /backups)
#   BACKUP_KEEP_DAYS    apaga conjuntos com mais de N dias (padrao 14; 0 desliga)
#   BACKUP_PASSPHRASE   se definida, cifra os arquivos com openssl enc -aes-256-cbc -pbkdf2
#   BACKUP_INCLUDE_ENV  true copia o .env (exige BACKUP_PASSPHRASE; padrao false)
#   ENV_FILE            caminho do .env montado (padrao /config/.env)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
BACKUP_TIME="${BACKUP_TIME:-02:30}"
BACKUP_INCLUDE_ENV="${BACKUP_INCLUDE_ENV:-false}"
BACKUP_PREFIX="${BACKUP_PREFIX:-cybereyes}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"
ENV_FILE="${ENV_FILE:-/config/.env}"
PBKDF2_ITER=200000

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }
fail() { log "ERRO: $*"; exit 1; }

encrypt() {
    openssl enc -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -salt -pass env:BACKUP_PASSPHRASE \
        -in "$1" -out "$1.enc" || fail "falha ao cifrar $(basename "$1")"
    rm -f "$1"
}

run_backup() {
    started=$(date +%s)
    stamp=$(date +%Y%m%d-%H%M%S)
    final="$BACKUP_DIR/$BACKUP_PREFIX-$stamp"
    work="$final.partial"
    umask 077
    mkdir -p "$work" || fail "nao foi possivel criar $work"
    trap 'rm -rf "$work"' EXIT

    case "$BACKUP_INCLUDE_ENV" in
        true|1|yes)
            [ -n "$BACKUP_PASSPHRASE" ] || fail "BACKUP_INCLUDE_ENV=true exige BACKUP_PASSPHRASE (o .env tem a VAULT_KEY)"
            [ -f "$ENV_FILE" ] || fail "BACKUP_INCLUDE_ENV=true, mas $ENV_FILE nao existe"
            ;;
    esac

    log "inicio: $final (banco $PGDATABASE em $PGHOST)"
    pg_dump -Fc -f "$work/postgres.dump" || fail "pg_dump falhou"
    pg_restore --list "$work/postgres.dump" > "$work/postgres.list" || fail "pg_restore --list nao conseguiu ler o dump"
    tables=$(grep -c ' TABLE DATA ' "$work/postgres.list" || true)
    [ "${tables:-0}" -gt 0 ] || fail "o dump nao contem dados de nenhuma tabela"
    log "postgres.dump ok ($(du -h "$work/postgres.dump" | cut -f1), $tables tabelas com dados)"

    case "$BACKUP_INCLUDE_ENV" in
        true|1|yes) cp "$ENV_FILE" "$work/env" && log ".env incluido" ;;
    esac

    encrypted=nao
    if [ -n "$BACKUP_PASSPHRASE" ]; then
        for f in "$work/postgres.dump" "$work"/*.tar.gz "$work/env"; do
            [ -f "$f" ] && encrypt "$f"
        done
        encrypted=sim
    fi

    {
        echo "data=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "postgres=$(psql -Atc 'show server_version' 2>/dev/null || echo desconhecido)"
        echo "pg_dump=$(pg_dump --version)"
        echo "cifrado=$encrypted"
        echo "pbkdf2_iter=$PBKDF2_ITER"
    } > "$work/manifest.txt"

    (cd "$work" && sha256sum $(ls | grep -v '^SHA256SUMS$') > SHA256SUMS) || fail "falha ao gerar SHA256SUMS"
    mv "$work" "$final" || fail "falha ao finalizar $final"
    trap - EXIT

    if [ "$BACKUP_KEEP_DAYS" -gt 0 ] 2>/dev/null; then
        find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "$BACKUP_PREFIX-*" ! -name '*.partial' \
            -mtime +"$BACKUP_KEEP_DAYS" -print -exec rm -rf {} + | while read -r old; do log "retencao: removido $old"; done
        find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "$BACKUP_PREFIX-*.partial" -mmin +1440 -exec rm -rf {} +
    fi

    log "concluido: $final ($(du -sh "$final" | cut -f1), cifrado=$encrypted, $(( $(date +%s) - started ))s)"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/.last-success"
}

next_run() {
    now=$(date +%s)
    target=$(date -d "$(date +%Y-%m-%d) $BACKUP_TIME" +%s) || fail "BACKUP_TIME invalido: $BACKUP_TIME"
    [ "$target" -gt "$now" ] || target=$((target + 86400))
    echo "$target"
}

case "${1:-}" in
    --daemon)
        case "$BACKUP_TIME" in
            [0-2][0-9]:[0-5][0-9]) ;;
            *) fail "BACKUP_TIME deve ser HH:MM (recebido: $BACKUP_TIME)" ;;
        esac
        trap 'log "encerrando"; exit 0' TERM INT
        log "agendado para $BACKUP_TIME ($(date +%Z)), retencao $BACKUP_KEEP_DAYS dias, destino $BACKUP_DIR"
        while :; do
            target=$(next_run)
            log "proximo backup: $(date -d "@$target" '+%Y-%m-%d %H:%M %Z')"
            sleep $((target - $(date +%s))) &
            wait $! || true
            if (run_backup); then :; else log "ERRO: backup falhou; nova tentativa no proximo horario"; fi
        done
        ;;
    "")
        run_backup
        ;;
    *)
        echo "uso: $0 [--daemon]" >&2
        exit 2
        ;;
esac
