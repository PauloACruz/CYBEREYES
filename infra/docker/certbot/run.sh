#!/bin/sh
# Emite (se ainda nao existir) e renova os certificados Let's Encrypt via webroot.
set -u

issue() {
    host="$1"
    [ -f "/etc/letsencrypt/live/$host/fullchain.pem" ] && return 0
    certbot certonly --webroot -w /var/www/certbot -d "$host" \
        --email "$ACME_EMAIL" --agree-tos --no-eff-email --non-interactive
}

sleep 15
while :; do
    issue "$WINCARE_HOST" || echo "Falha ao emitir certificado para $WINCARE_HOST, nova tentativa em 1 h"
    issue "$MESH_HOST" || echo "Falha ao emitir certificado para $MESH_HOST, nova tentativa em 1 h"
    certbot renew --webroot -w /var/www/certbot --quiet || echo "Falha na renovacao, nova tentativa em 1 h"
    sleep 3600
done
