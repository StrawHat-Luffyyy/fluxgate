import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import {
  DATABASE_URL,
  FRONTEND_PORT,
  FRONTEND_URL,
  GATEWAY_PORT,
  GATEWAY_URL,
  INTERNAL_ALERT_SECRET,
  REDIS_URL,
} from "./e2e/constants";

/**
 * Runs against a real gateway, Postgres and Redis. Playwright starts and stops both
 * servers, so nothing outlives the run.
 *
 * The gateway loads the root .env under NODE_ENV=development, but dotenv never
 * overrides a variable that is already set, so everything in gatewayEnv wins. That
 * covers every variable that affects this suite, and pins the database to a local
 * one: this run must never reach a remote database, whatever a .env file says. The
 * one left out is METRICS_TOKEN, which must be 16+ characters if set at all, so it
 * cannot be pinned to "unset"; no test calls /metrics.
 *
 * Prerequisites: Postgres, Redis and Redpanda on localhost (docker compose), and a
 * database named fluxgate_ui_test. Migrations are applied at startup.
 */
const repoRoot = path.resolve(__dirname, "..");

const gatewayEnv = {
  NODE_ENV: "development",
  PORT: String(GATEWAY_PORT),
  LOG_LEVEL: "warn",

  DATABASE_URL,
  // Its own logical database: BullMQ workers on one Redis database compete for one
  // queue, so any other gateway using the default database could take this one's
  // webhook jobs, then find no matching row in its own Postgres.
  REDIS_URL,
  REDIS_COMMAND_TIMEOUT_MS: "250",
  KAFKA_BROKER: "localhost:19092",
  KAFKA_TOPIC: "gateway.traffic.logs",

  JWT_SECRET: "e2e-only-jwt-secret-at-least-32-characters-long",
  INTERNAL_ALERT_SECRET,
  SECRETS_ENCRYPTION_KEY: "e2e-only-secrets-encryption-key",

  CORS_ORIGINS: FRONTEND_URL,
  COOKIE_SECURE: "false",
  TRUST_PROXY: "false",

  // Tests run an upstream and a webhook receiver on localhost.
  ALLOW_PRIVATE_TARGETS: "true",
  UPSTREAM_TIMEOUT_MS: "30000",

  // So a failing webhook reaches "dead", and can be retried, within a test.
  WEBHOOK_MAX_ATTEMPTS: "2",
  WEBHOOK_BACKOFF_MS: "200",
  WEBHOOK_TIMEOUT_MS: "5000",

  OTEL_ENABLED: "false",
  OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
  SENTRY_DSN: "",
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
  // test:e2e runs "e2e". Screenshots are for review, take minutes and assert little,
  // so they have their own script, test:e2e:screenshots.
  projects: [
    { name: "e2e", testIgnore: "**/screenshots.spec.ts" },
    { name: "screenshots", testMatch: "**/screenshots.spec.ts" },
  ],
  webServer: [
    {
      command: "pnpm db:migrate && node --import tsx src/server.ts",
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
      env: { NEXT_PUBLIC_API_URL: GATEWAY_URL, NEXT_OUTPUT_STANDALONE: "false" },
      url: `${FRONTEND_URL}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
