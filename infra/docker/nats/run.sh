#!/bin/sh
# Inicia o NATS e recarrega a configuracao quando o backend reescreve o arquivo de usuarios
# (um usuario por agente). A recarga nao derruba as conexoes existentes.
set -eu

AUTH_DIR=/etc/nats/auth
AUTH_FILE="$AUTH_DIR/users.conf"
API_UID="${API_UID:-1654}"

mkdir -p "$AUTH_DIR"
if [ ! -s "$AUTH_FILE" ]; then
    printf 'authorization {\n  users = [\n    {user: "%s", password: "%s", permissions: {publish: ">", subscribe: ">"}}\n  ]\n}\n' \
        "$NATS_API_USER" "$NATS_API_PASSWORD" > "$AUTH_FILE"
fi
chown -R "$API_UID:$API_UID" "$AUTH_DIR"
chmod 0750 "$AUTH_DIR"
chmod 0640 "$AUTH_FILE"

nats-server -c /etc/nats/nats.conf &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT

last=$(md5sum "$AUTH_FILE" 2>/dev/null || true)
while kill -0 "$pid" 2>/dev/null; do
    sleep 2
    current=$(md5sum "$AUTH_FILE" 2>/dev/null || true)
    if [ "$current" != "$last" ]; then
        kill -HUP "$pid" && last="$current"
    fi
done
wait "$pid"
