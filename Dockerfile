# --------------------------------------------------
# Stage 1: Install All Dependencies (for building)
# --------------------------------------------------
FROM node:22-alpine AS deps

RUN apk add --no-cache dumb-init wget
RUN corepack enable pnpm

WORKDIR /app

# Copy dependency manifests + workspace config for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (dev + prod)
RUN pnpm install --frozen-lockfile --filter .

# --------------------------------------------------
# Stage 2: Build Application
# --------------------------------------------------
FROM deps AS builder

WORKDIR /app

COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN pnpm run build

# --------------------------------------------------
# Stage 3: Install Production Dependencies Only
# --------------------------------------------------
FROM node:22-alpine AS prod-deps

RUN apk add --no-cache dumb-init wget
RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only production dependencies for the backend root
RUN pnpm install --prod --frozen-lockfile --filter .

# --------------------------------------------------
# Stage 4: Production Runtime
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

# Copy production artifacts and node_modules
COPY --from=builder --chown=fluxgate:fluxgate /app/dist ./dist
COPY --from=prod-deps --chown=fluxgate:fluxgate /app/node_modules ./node_modules
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