import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(), // Require a valid Postgres URL connection string
  REDIS_URL: z.string().url().default("redis://localhost:6379"), // Require a valid Redis URL connection string
  JWT_SECRET: z.string().min(32).default("default-jwt-secret-key"), // Require a JWT secret with a minimum length of 32 characters
  KAFKA_BROKER: z.string().default("localhost:19092"), // Require a valid Kafka broker URL connection string
  OTLP_ENDPOINT: z.string().url().default("http://localhost:4318/v1/traces"), // Require a valid OTLP endpoint URL connection string
  SENTRY_DSN: z.string().optional(), // Optional Sentry DSN for error tracking
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;
