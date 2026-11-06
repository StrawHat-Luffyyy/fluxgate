import { defineConfig } from "vitest/config";

// Starts real processes: the gateway and the Python consumer, against the real
// Postgres, Redis and Redpanda from docker compose. Slow, so kept apart.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    globalSetup: ["tests/integration/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      LOG_LEVEL: "silent",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://fluxgate:fluxgate@localhost:5432/fluxgate_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2",
    },
  },
});
