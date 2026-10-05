#!/bin/sh
# Escolhe o certificado de cada host, nesta ordem: certificado proprio em
# /etc/nginx/custom-certs/<host>, Let's Encrypt, ou autoassinado temporario
# (permite o Nginx subir antes da primeira emissao do Let's Encrypt).
set -eu

for host in "$CYBEREYES_HOST"; do
    custom="/etc/nginx/custom-certs/$host"
    letsencrypt="/etc/letsencrypt/live/$host"
    selfsigned="/etc/nginx/selfsigned/$host"
    target="/etc/nginx/certs/$host"
    mkdir -p "$target"

    if [ -f "$custom/fullchain.pem" ] && [ -f "$custom/privkey.pem" ]; then
        source_dir="$custom"
    elif [ -f "$letsencrypt/fullchain.pem" ] && [ -f "$letsencrypt/privkey.pem" ]; then
        source_dir="$letsencrypt"
    else
        if [ ! -f "$selfsigned/fullchain.pem" ]; then
            mkdir -p "$selfsigned"
            openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj "/CN=$host" \
                -keyout "$selfsigned/privkey.pem" -out "$selfsigned/fullchain.pem" >/dev/null 2>&1
        fi
        source_dir="$selfsigned"
    fi

    ln -sfn "$source_dir/fullchain.pem" "$target/fullchain.pem"
    ln -sfn "$source_dir/privkey.pem" "$target/privkey.pem"
done
