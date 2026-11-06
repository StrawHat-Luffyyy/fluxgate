# Gateway image. Also runs migrations, the seed and the demo services (see
# docker-compose.yml), so that those use exactly the code that serves traffic.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json

# --- Build with dev dependencies ---
FROM base AS builder
RUN pnpm install --frozen-lockfile --filter .
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# --- Runtime dependencies only ---
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --filter . --prod

# --- Runtime ---
FROM node:22-alpine AS runner
LABEL org.opencontainers.image.title="FluxGate API Gateway" \
      org.opencontainers.image.source="https://github.com/StrawHat-Luffyyy/fluxgate"

RUN apk add --no-cache dumb-init
RUN addgroup -S fluxgate && adduser -S fluxgate -G fluxgate

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=fluxgate:fluxgate /app/node_modules ./node_modules
COPY --from=builder --chown=fluxgate:fluxgate /app/dist ./dist
COPY --chown=fluxgate:fluxgate package.json ./
COPY --chown=fluxgate:fluxgate drizzle ./drizzle

USER fluxgate
EXPOSE 3000

# Liveness, not readiness: restarting the gateway would not fix a database outage.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health/live" || exit 1

# dumb-init forwards SIGTERM, so graceful shutdown runs when the container stops.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
