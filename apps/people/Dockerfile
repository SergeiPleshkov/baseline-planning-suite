# Build context is the repository root: docker build -f apps/people/Dockerfile .
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo

# Only the lockfile decides what is downloaded, so this layer survives source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@baseline/people..." \
 && pnpm --filter @baseline/people build

# The server is bundled with everything it needs, so the image carries no node_modules.
FROM node:24-alpine
WORKDIR /app
COPY --from=build /repo/apps/people/dist ./dist
COPY --from=build /repo/apps/people/dist-server/main.js ./main.js
COPY seed/baseline-seed.json ./seed.json
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STATIC_DIR=/app/dist SEED_FILE=/app/seed.json
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8080/api/people/v1/employees || exit 1
CMD ["node", "main.js"]
