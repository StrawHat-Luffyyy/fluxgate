import { defineConfig } from "vitest/config";

// Unit tests: no running services needed. Anything touching Postgres or Redis
// belongs in tests/integration (see vitest.integration.config.ts).
export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    include: ["tests/unit/**/*.test.ts"],
    env: {
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://unused:unused@localhost:1/unit_tests_must_not_connect",
      REDIS_URL: "redis://localhost:1",
    },
  },
});
