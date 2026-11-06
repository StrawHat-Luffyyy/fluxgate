# Build from the repository root, which holds the pnpm lockfile:
#   docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:3000 .

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile --filter frontend

COPY frontend ./frontend
# Inlined into the browser bundle at build time, so it cannot be set at run time.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter frontend build

FROM node:22-alpine AS runner
RUN apk add --no-cache dumb-init
RUN addgroup -S fluxgate && adduser -S fluxgate -G fluxgate

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=fluxgate:fluxgate /app/frontend/.next/standalone ./
COPY --from=builder --chown=fluxgate:fluxgate /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=fluxgate:fluxgate /app/frontend/public ./frontend/public

USER fluxgate
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/login" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "frontend/server.js"]
