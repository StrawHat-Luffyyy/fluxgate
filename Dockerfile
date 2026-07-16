FROM node:22-alpine AS builder

# Enable pnpm via Corepack
RUN corepack enable pnpm

WORKDIR /app

# Copy workspace definition and dependency lockfiles first for optimal layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/package.json ./frontend/package.json

# Install all dependencies across the workspace
RUN pnpm install --frozen-lockfile

# Copy the entire source code
COPY . .

# Build the TypeScript backend project
RUN pnpm run build

# Prune devDependencies across the workspace to keep image size tiny
RUN pnpm prune --prod

# ---------------------------------------
# Stage 2: Production Runner
# ---------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy compiled JavaScript output and pruned production node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

# Expose standard Gateway port
EXPOSE 3000

# Execute compiled server directly (No tsx/typescript needed in prod)
CMD ["node", "dist/server.js"]