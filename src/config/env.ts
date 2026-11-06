import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Env loading lives here so it cannot depend on import order: anything reading
// `env` gets .env applied first. Tests skip .env entirely so that a developer's
// real DATABASE_URL can never be reached from the test suite.
if (process.env.NODE_ENV !== "test") {
  loadDotenv({ quiet: true });
}

const DEV_JWT_SECRET = "dev-only-jwt-secret-do-not-use-in-production";
const DEV_ALERT_SECRET = "dev-only-internal-alert-secret";
const DEV_ENCRYPTION_KEY = "dev-only-secrets-encryption-key";

const csv = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z
  .object({
    // Unset means production, so a deployment that forgets it gets the strict
    // checks below rather than silently running with the development secrets.
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .optional(),

    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://fluxgate:fluxgate@localhost:5432/fluxgate"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(250),

    KAFKA_BROKER: z.string().default("localhost:19092").transform(csv),
    KAFKA_TOPIC: z.string().default("gateway.traffic.logs"),

    JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
    INTERNAL_ALERT_SECRET: z.string().min(16).default(DEV_ALERT_SECRET),
    SECRETS_ENCRYPTION_KEY: z.string().min(16).default(DEV_ENCRYPTION_KEY),
    METRICS_TOKEN: z.string().min(16).optional(),

    CORS_ORIGINS: z.string().default("http://localhost:3001").transform(csv),
    COOKIE_SECURE: z.stringbool().optional(),
    TRUST_PROXY: z.stringbool().default(false),

    ALLOW_PRIVATE_TARGETS: z.stringbool().default(false),
    UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
    WEBHOOK_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

    OTEL_ENABLED: z.stringbool().default(false),
    OTLP_ENDPOINT: z.string().url().default("http://localhost:4318/v1/traces"),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;

    const devDefaults = [
      ["JWT_SECRET", DEV_JWT_SECRET],
      ["INTERNAL_ALERT_SECRET", DEV_ALERT_SECRET],
      ["SECRETS_ENCRYPTION_KEY", DEV_ENCRYPTION_KEY],
    ] as const;
    for (const [key, devDefault] of devDefaults) {
      if (value[key] === devDefault) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be set explicitly in production`,
        });
      }
    }
    if (!value.METRICS_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["METRICS_TOKEN"],
        message: "METRICS_TOKEN must be set in production",
      });
    }
    if (value.ALLOW_PRIVATE_TARGETS && !process.env.FLUXGATE_DEMO_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_PRIVATE_TARGETS"],
        message:
          "ALLOW_PRIVATE_TARGETS disables SSRF protection and is refused in production unless FLUXGATE_DEMO_MODE is set",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Cannot use the pino logger here: logger.ts itself depends on env.
  process.stderr.write(
    `Invalid environment variables:\n${JSON.stringify(z.treeifyError(parsed.error), null, 2)}\n`,
  );
  process.exit(1);
}

export const env = parsed.data;
export const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === "production";
