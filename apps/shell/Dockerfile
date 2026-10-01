# Build context is the repository root: docker build -f apps/shell/Dockerfile .
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo

# Only the lockfile decides what is downloaded, so this layer survives source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@baseline/shell..." \
 && pnpm --filter @baseline/shell build \
 && node apps/shell/nginx/make-config-template.mjs apps/shell/public/config.json /config.json.template \
 # The development copy of config.json must not be mistaken for the deployed one.
 && rm apps/shell/dist/config.json

FROM nginxinc/nginx-unprivileged:1.29-alpine
# The start-up script writes config.json next to the bundle, so the unprivileged user owns the folder.
USER root
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx
COPY --from=build --chown=nginx:nginx /repo/apps/shell/dist /usr/share/nginx/html
COPY --from=build /config.json.template /etc/baseline/config.json.template
COPY apps/shell/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 apps/shell/nginx/30-config-json.sh /docker-entrypoint.d/30-config-json.sh

ENV PEOPLE_UPSTREAM=http://people:8080 \
    DELIVERY_UPSTREAM=http://delivery:8080 \
    PEOPLE_REMOTE_ENTRY=/mf/people/mf-manifest.json \
    DELIVERY_REMOTE_ENTRY=/mf/delivery/mf-manifest.json
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8080/config.json || exit 1
