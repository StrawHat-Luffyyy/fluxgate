
FROM node:22-alpine AS deps

RUN apk add --no-cache dumb-init

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


FROM deps AS builder

WORKDIR /app

COPY tsconfig.json ./
COPY src/ ./src/

RUN pnpm build

RUN pnpm prune --prod


FROM node:22-alpine AS runner

RUN addgroup --system --gid 1001 fluxgate && \
  adduser --system --uid 1001 --ingroup fluxgate fluxgate

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /usr/bin/dumb-init /usr/bin/dumb-init

COPY --from=builder --chown=fluxgate:fluxgate /app/dist ./dist
COPY --from=builder --chown=fluxgate:fluxgate /app/node_modules ./node_modules
COPY --from=builder --chown=fluxgate:fluxgate /app/package.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

USER fluxgate

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/server.js"]