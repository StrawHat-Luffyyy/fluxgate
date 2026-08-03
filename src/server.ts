import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./redis/client.js";
import { connectProducer, disconnectProducer } from "./kafka/producer.js";
import { startWebhookWorker } from "./queue/webhookWorker.js";
import { startTracing } from "./monitoring/tracing.js";
import { initSentry } from "./monitoring/sentry.js";
import { createChildLogger } from "./lib/logger.js";

const log = createChildLogger("server");

initSentry();

await startTracing();
await connectProducer();

log.info(
  { port: env.PORT, env: env.NODE_ENV },
  `FluxGate Edge Router starting on port ${env.PORT} in ${env.NODE_ENV} mode`,
);

const worker = startWebhookWorker();

serve({
  fetch: app.fetch,
  port: env.PORT,
});

const shutdown = async () => {
  log.info("Shutting down gracefully...");
  try {
    await disconnectProducer();
    await redis.quit();
    await worker.close();
    log.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
