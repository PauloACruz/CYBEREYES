#!/bin/sh
# Recarrega o Nginx quando um certificado muda (emissao ou renovacao).
fingerprint() {
    for host in "$WINCARE_HOST" "$MESH_HOST"; do
        readlink -f "/etc/nginx/certs/$host/fullchain.pem"
        md5sum "/etc/nginx/certs/$host/fullchain.pem" 2>/dev/null
    done
}

(
    last=$(fingerprint)
    while sleep 300; do
        /usr/local/bin/wincare-certs || continue
        current=$(fingerprint)
        if [ "$current" != "$last" ]; then
            nginx -s reload && last="$current"
        fi
    done
) &
