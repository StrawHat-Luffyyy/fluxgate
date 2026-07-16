# --------------------------------------------------
# Stage 1: Install Dependencies
# --------------------------------------------------
FROM node:22-alpine AS deps

RUN apk add --no-cache dumb-init wget
RUN corepack enable

WORKDIR /app

# Copy dependency manifests + workspace config for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only the root workspace (backend) deps — skip the frontend workspace
RUN pnpm install --frozen-lockfile --filter .

# --------------------------------------------------
# Stage 2: Build
# --------------------------------------------------
FROM deps AS builder

WORKDIR /app

COPY src/ ./src/
COPY tsconfig.json ./

RUN pnpm run build

# Strip dev dependencies for the production image
RUN pnpm prune --prod --config.confirmModulesPurge=false

# --------------------------------------------------
# Stage 3: Production Runtime
# --------------------------------------------------
FROM node:22-alpine AS runner

LABEL org.opencontainers.image.title="FluxGate API Gateway" \
      org.opencontainers.image.description="Edge-native API Gateway & Traffic Intelligence Platform" \
      org.opencontainers.image.source="https://github.com/StrawHat-Luffyyy/fluxgate"

RUN apk add --no-cache dumb-init wget

RUN addgroup -S fluxgate && \
    adduser -S fluxgate -G fluxgate

WORKDIR /app

ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=builder --chown=fluxgate:fluxgate /app/dist ./dist
COPY --from=builder --chown=fluxgate:fluxgate /app/node_modules ./node_modules
COPY --from=builder --chown=fluxgate:fluxgate /app/package.json ./package.json

USER fluxgate

EXPOSE 3000

HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=10s \
            --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]