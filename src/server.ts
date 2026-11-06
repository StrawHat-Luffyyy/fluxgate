import { serve, type ServerType } from "@hono/node-server";
import app from "./app.js";
import { env } from "./config/env.js";
import { closeDb } from "./db/index.js";
import { startProducer, stopProducer } from "./kafka/producer.js";
import { createChildLogger } from "./lib/logger.js";
import { closeOutboundConnections } from "./lib/ssrf.js";
import { initSentry } from "./monitoring/sentry.js";
import { startTracing, stopTracing } from "./monitoring/tracing.js";
import { closeWebhookQueue } from "./queue/webhookQueue.js";
import { startRequestLogWriter, stopRequestLogWriter } from "./telemetry/requestLogWriter.js";
import { startWebhookWorker } from "./queue/webhookWorker.js";
import { redis } from "./redis/client.js";
import { markDraining } from "./services/health.service.js";

const log = createChildLogger("server");

const SHUTDOWN_TIMEOUT_MS = 25_000;
const DRAIN_TIMEOUT_MS = 15_000;
// Gives a load balancer time to see the failing readiness probe before the
// listening socket closes.
const READINESS_DRAIN_MS = env.NODE_ENV === "production" ? 2_000 : 0;

initSentry();
await startTracing();
startProducer();
startRequestLogWriter();
const worker = startWebhookWorker();

const server: ServerType = serve({ fetch: app.fetch, port: env.PORT });
log.info({ port: env.PORT, env: env.NODE_ENV }, `FluxGate listening on port ${env.PORT}`);

const closeServer = () =>
  new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    // close() waits for in-flight responses. Idle keep-alive sockets would
    // otherwise hold it open until they time out.
    if ("closeIdleConnections" in server) server.closeIdleConnections();
    // A long-lived stream must not use up the budget that flushing telemetry needs.
    setTimeout(() => {
      log.warn("Drain timed out, closing remaining connections");
      if ("closeAllConnections" in server) server.closeAllConnections();
    }, DRAIN_TIMEOUT_MS).unref();
  });

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Shutting down: draining in-flight requests");

  const forceExit = setTimeout(() => {
    log.error("Shutdown timed out, exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    markDraining();
    await new Promise((resolve) => setTimeout(resolve, READINESS_DRAIN_MS));

    // Order matters: stop taking requests first, because they are what produces
    // telemetry and webhook jobs, then close what those depend on.
    await closeServer();
    await worker.close();
    await closeWebhookQueue();
    await stopProducer();
    await stopRequestLogWriter();
    await closeOutboundConnections();
    await closeDb();
    await redis.quit().catch(() => redis.disconnect());
    await stopTracing();

    log.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
