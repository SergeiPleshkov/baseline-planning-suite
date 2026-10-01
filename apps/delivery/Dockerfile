# Build context is the repository root: docker build -f apps/delivery/Dockerfile .
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo

# Only the lockfile decides what is downloaded, so this layer survives source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@baseline/delivery..." \
 && pnpm --filter @baseline/delivery build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY --from=build --chown=nginx:nginx /repo/apps/delivery/dist /usr/share/nginx/html
COPY apps/delivery/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8080/mf-manifest.json || exit 1
