import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Runs against a real gateway, Postgres and Redis. Playwright starts and stops both
 * servers, so nothing outlives the run. Every gateway variable is set here, and the
 * database is fixed to a local one: this suite must never reach a remote database,
 * whatever a .env file says (env.ts does not override variables that are already set).
 *
 * Prerequisites: Postgres, Redis and Redpanda on localhost (docker compose), and a
 * database named fluxgate_ui_test. Migrations are applied at startup.
 */
const GATEWAY_PORT = 3005;
const FRONTEND_PORT = 3006;
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

const repoRoot = path.resolve(__dirname, "..");

const gatewayEnv = {
  DATABASE_URL: "postgresql://fluxgate:fluxgate@localhost:5432/fluxgate_ui_test",
  // Its own logical database: BullMQ workers on one Redis database compete for one
  // queue, so any other gateway using the default database could take this one's
  // webhook jobs, then find no matching row in its own Postgres.
  REDIS_URL: "redis://localhost:6379/1",
  KAFKA_BROKER: "localhost:19092",
  NODE_ENV: "development",
  PORT: String(GATEWAY_PORT),
  CORS_ORIGINS: FRONTEND_URL,
  // Tests run an upstream and a webhook receiver on localhost.
  ALLOW_PRIVATE_TARGETS: "true",
  OTEL_ENABLED: "false",
  SENTRY_DSN: "",
  // So a failing webhook reaches "dead", and can be retried, within a test.
  WEBHOOK_MAX_ATTEMPTS: "2",
  WEBHOOK_BACKOFF_MS: "200",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/artifacts/test-results",
  // The whole suite shares one gateway and the per-IP auth throttle, so run it in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command:
        "pnpm db:migrate && node frontend/e2e/reset-throttle.mjs && node --import tsx src/server.ts",
      cwd: repoRoot,
      env: gatewayEnv,
      url: `${GATEWAY_URL}/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // A production build, so what is verified is what ships. The API URL is inlined at build time.
      command: `pnpm exec next build && pnpm exec next start --port ${FRONTEND_PORT}`,
      cwd: __dirname,
      env: { NEXT_PUBLIC_API_URL: GATEWAY_URL },
      url: `${FRONTEND_URL}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
