# pg_dump/pg_restore da mesma versao do servidor + openssl para a cifragem opcional.
FROM postgres:17-alpine
RUN apk add --no-cache openssl
COPY --chmod=755 backup.sh /usr/local/bin/backup.sh
ENTRYPOINT []
CMD ["backup.sh", "--daemon"]
