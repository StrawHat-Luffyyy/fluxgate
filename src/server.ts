import { serve } from "@hono/node-server";
import app from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./redis/client.js";
import { connectProducer, disconnectProducer } from "./kafka/producer.js";
import { startWebhookWorker } from "./queue/webhookWorker.js";
import { startTracing } from "./monitoring/tracing.js";
import { initSentry } from "./monitoring/sentry.js";

initSentry();

await startTracing();
await connectProducer();

console.log(
  `FluxGate Edge Router starting on port ${env.PORT} in ${env.NODE_ENV} mode...`,
);
const worker = startWebhookWorker();

serve({
  fetch: app.fetch,
  port: env.PORT,
});

const shutdown = async () => {
  console.log("\n Shutting down gracefully...");
  try {
    await disconnectProducer();
    await redis.quit();
    await worker.close();
    console.log("Shutdown complete.");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
