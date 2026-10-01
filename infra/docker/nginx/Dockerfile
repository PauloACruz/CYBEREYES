FROM nginx:1.28-alpine
RUN apk add --no-cache openssl
COPY --chmod=755 wincare-certs.sh /usr/local/bin/wincare-certs
COPY --chmod=755 entrypoint.d/ /docker-entrypoint.d/
COPY templates/ /etc/nginx/templates/
ENV NGINX_ENVSUBST_FILTER="^(WINCARE_HOST|MESH_HOST)$"
