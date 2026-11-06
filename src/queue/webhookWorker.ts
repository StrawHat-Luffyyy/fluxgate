import { UnrecoverableError, Worker, type Job } from "bullmq";
import { and, eq, lt } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { webhookDeliveries, webhookEndpoints } from "../db/schema.js";
import { createChildLogger } from "../lib/logger.js";
import { createRequestContext, runWithRequestContext } from "../lib/requestContext.js";
import { decryptSecret } from "../lib/secretBox.js";
import { signPayload } from "../lib/signature.js";
import { BlockedTargetError, guardedFetch } from "../lib/ssrf.js";
import { webhookDeliveries as deliveryMetric, webhookQueueDepth } from "../monitoring/metrics.js";
import { workerConnection } from "./connection.js";
import { enqueueDelivery, queueDepths, WEBHOOK_QUEUE, type WebhookJob } from "./webhookQueue.js";

const log = createChildLogger("webhook-worker");

const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_MIN_AGE_MS = 30_000;
const SWEEP_BATCH = 100;
const QUEUE_DEPTH_INTERVAL_MS = 10_000;

/** A 4xx means the receiver rejected this payload; repeating it will not help. */
const isPermanentStatus = (status: number) =>
  (status >= 300 && status < 400) ||
  (status >= 400 && status < 500 && status !== 408 && status !== 429);

const recordFailure = async (
  deliveryId: string,
  attempts: number,
  isFinal: boolean,
  lastError: string,
  lastStatusCode: number | null,
) => {
  deliveryMetric.inc({ outcome: isFinal ? "dead" : "retry" });
  await db
    .update(webhookDeliveries)
    .set({
      attempts,
      lastError,
      lastStatusCode,
      status: isFinal ? "dead" : "pending",
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
};

export const processDelivery = async (job: Job<WebhookJob>) => {
  const { deliveryId } = job.data;

  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      url: webhookEndpoints.url,
      encryptedSecret: webhookEndpoints.encryptedSecret,
      enabledAt: webhookEndpoints.enabledAt,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);

  // Delivered, dead, or deleted along with its endpoint. Only pending rows are
  // sent, so a stale job cannot revive a dead delivery or send one twice.
  if (!row || row.delivery.status !== "pending") return;

  const attempts = row.delivery.attempts + 1;
  const maxAttempts = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

  if (!row.enabledAt) {
    await recordFailure(deliveryId, attempts, true, "Endpoint is disabled", null);
    throw new UnrecoverableError("Endpoint is disabled");
  }

  const body = JSON.stringify({
    id: row.delivery.id,
    type: row.delivery.eventType,
    createdAt: row.delivery.createdAt.toISOString(),
    data: row.delivery.payload,
  });

  let status: number;
  try {
    const response = await guardedFetch(row.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FluxGate-Webhooks/1.0",
        "X-FluxGate-Delivery": row.delivery.id,
        "X-FluxGate-Event": row.delivery.eventType,
        "X-FluxGate-Signature": signPayload(decryptSecret(row.encryptedSecret), body),
      },
      body,
      signal: AbortSignal.timeout(env.WEBHOOK_TIMEOUT_MS),
    });
    status = response.status;
    await response.body?.cancel();
  } catch (err) {
    const blocked =
      err instanceof BlockedTargetError ||
      (err as { cause?: unknown }).cause instanceof BlockedTargetError;
    const message = blocked
      ? "Target resolves to a private address"
      : ((err as { cause?: Error }).cause?.message ?? (err as Error).message);
    await recordFailure(deliveryId, attempts, blocked || isFinalAttempt, message, null);
    throw blocked ? new UnrecoverableError(message) : err;
  }

  if (status >= 200 && status < 300) {
    deliveryMetric.inc({ outcome: "delivered" });
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        attempts,
        lastStatusCode: status,
        lastError: null,
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    log.info({ deliveryId, status, attempts }, "Webhook delivered");
    return;
  }

  const message = `Receiver responded with ${status}`;
  const permanent = isPermanentStatus(status);
  await recordFailure(deliveryId, attempts, permanent || isFinalAttempt, message, status);
  throw permanent ? new UnrecoverableError(message) : new Error(message);
};

/**
 * Outbox sweep: re-enqueues deliveries that are committed but stuck in `pending`,
 * for example because Redis was down when they were created. A job that is still
 * queued keeps its id, so adding it again is a no-op.
 */
export const sweepPendingDeliveries = async (minAgeMs = SWEEP_MIN_AGE_MS) => {
  const stuck = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lt(webhookDeliveries.updatedAt, new Date(Date.now() - minAgeMs)),
      ),
    )
    .limit(SWEEP_BATCH);
  await Promise.all(stuck.map(({ id }) => enqueueDelivery(id)));
  return stuck.length;
};

/** A retry or a redelivery logs under the same ids as the request that caused it. */
const processInContext = (job: Job<WebhookJob>) =>
  runWithRequestContext(
    createRequestContext(job.data.requestId ?? job.data.deliveryId, {
      traceparent: job.data.traceparent,
    }),
    async () => {
      try {
        await processDelivery(job);
      } catch (err) {
        // Logged here because the worker's "failed" event runs outside this context.
        log.warn(
          {
            deliveryId: job.data.deliveryId,
            attemptsMade: job.attemptsMade + 1,
            err: (err as Error).message,
          },
          "Webhook attempt failed",
        );
        throw err;
      }
    },
  );

const refreshQueueDepth = async () => {
  for (const [state, count] of Object.entries(await queueDepths())) {
    webhookQueueDepth.set({ state }, count);
  }
};

export const startWebhookWorker = () => {
  const worker = new Worker<WebhookJob>(WEBHOOK_QUEUE, processInContext, {
    connection: workerConnection(),
    concurrency: 10,
  });

  worker.on("error", (err) => {
    log.warn({ err }, "Webhook worker connection error");
  });

  const sweeper = setInterval(() => {
    sweepPendingDeliveries().catch((err) => log.warn({ err }, "Delivery sweep failed"));
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  // Polled rather than read at scrape time, so a Redis outage cannot slow /metrics.
  const depthPoller = setInterval(() => {
    refreshQueueDepth().catch((err) => log.debug({ err }, "Queue depth refresh failed"));
  }, QUEUE_DEPTH_INTERVAL_MS);
  depthPoller.unref();

  log.info("Webhook worker started");
  return {
    close: async () => {
      clearInterval(sweeper);
      clearInterval(depthPoller);
      await worker.close();
    },
  };
};
