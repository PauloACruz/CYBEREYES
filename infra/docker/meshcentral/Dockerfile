FROM node:22-alpine
ARG MESHCENTRAL_VERSION=1.2.5
RUN apk add --no-cache bash tini
WORKDIR /opt/meshcentral
RUN npm install --omit=dev meshcentral@${MESHCENTRAL_VERSION} \
    && mkdir -p /opt/meshcentral/meshcentral-data /opt/meshcentral/meshcentral-files /opt/meshcentral/shared \
    && chown -R node:node /opt/meshcentral
COPY --chmod=755 entrypoint.sh /entrypoint.sh
USER node
EXPOSE 4443
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
