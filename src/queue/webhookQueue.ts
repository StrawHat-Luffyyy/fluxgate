import { Queue } from "bullmq";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";
import { producerConnection } from "./connection.js";

const log = createChildLogger("webhook-queue");

export const WEBHOOK_QUEUE = "webhooks";
const ENQUEUE_TIMEOUT_MS = 1_000;

export interface WebhookJob {
  deliveryId: string;
}

let queue: Queue<WebhookJob> | undefined;

/** Lazy so that importing the app, as tests do, opens no Redis connection. */
export const getWebhookQueue = (): Queue<WebhookJob> => {
  if (!queue) {
    queue = new Queue<WebhookJob>(WEBHOOK_QUEUE, {
      connection: producerConnection(),
      defaultJobOptions: {
        attempts: env.WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: env.WEBHOOK_BACKOFF_MS, jitter: 0.5 },
        removeOnComplete: true,
        // State lives in webhook_deliveries, so Redis needs no copy, and removing
        // the job allows a manual retry to reuse the same job id.
        removeOnFail: true,
      },
    });
    queue.on("error", (err) => log.warn({ err }, "Webhook queue connection error"));
  }
  return queue;
};

/**
 * The delivery row is already committed when this runs, so a failure here is not
 * lost: the sweeper in webhookWorker.ts picks up rows left pending. Using the
 * delivery id as job id makes that re-enqueue idempotent.
 */
export const enqueueDelivery = async (deliveryId: string): Promise<boolean> => {
  try {
    await Promise.race([
      getWebhookQueue().add("deliver", { deliveryId }, { jobId: deliveryId }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Enqueue timed out")), ENQUEUE_TIMEOUT_MS).unref(),
      ),
    ]);
    return true;
  } catch (err) {
    log.warn({ err, deliveryId }, "Could not enqueue delivery, the sweeper will retry");
    return false;
  }
};

/**
 * The job that gave up may not have been removed yet, and adding a job whose id
 * still exists is silently ignored. If removal fails, the job is still active; the
 * row is already pending, so the sweeper enqueues it shortly after it finishes.
 */
export const enqueueRetry = async (deliveryId: string) => {
  try {
    await (await getWebhookQueue().getJob(deliveryId))?.remove();
  } catch (err) {
    log.debug({ err, deliveryId }, "Previous job not removable yet");
  }
  await enqueueDelivery(deliveryId);
};

export const closeWebhookQueue = async () => {
  await queue?.close();
  queue = undefined;
};
