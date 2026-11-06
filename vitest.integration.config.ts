import { defineConfig } from "vitest/config";

// Needs real Postgres and Redis: `docker compose up -d postgres redis`.
// tests/integration/globalSetup.ts refuses any database that is not local and
// named *_test, and env.ts does not read .env under NODE_ENV=test.
export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/globalSetup.ts"],
    // Test files share one database and flush one Redis db.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      LOG_LEVEL: "silent",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://fluxgate:fluxgate@localhost:5432/fluxgate_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
      // Test upstreams and webhook receivers listen on localhost. The SSRF guard
      // itself is covered by tests/unit/ssrf.test.ts with this left off.
      ALLOW_PRIVATE_TARGETS: "true",
      WEBHOOK_MAX_ATTEMPTS: "3",
      WEBHOOK_BACKOFF_MS: "10",
      UPSTREAM_TIMEOUT_MS: "1000",
    },
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/db/migrate.ts", "src/monitoring/tracing.ts", "src/monitoring/sentry.ts"],
      // server.ts and the Kafka client are exercised by tests/e2e, which is not measured here.
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
        "src/{proxy,middleware,lib,redis}/**": { lines: 85, branches: 70 },
      },
    },
  },
});
