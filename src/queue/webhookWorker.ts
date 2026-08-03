import { Worker, type Job } from "bullmq";
import { getRedisConnectionOptions } from "./connection.js";
import type { ConnectionOptions } from "bullmq";
import type { WebhookPayload } from "./webhookQueue.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("webhook-worker");

// TODO: In production, this URL should come from a per-tenant database field
const MOCK_TENANT_WEBHOOK_URL = "https://webhook.site/9345eb90-7f3e-40f1-bc61-ff488a96f03f"

export const startWebhookWorker = () => {
  log.info("BullMQ Webhook Worker started");

  const worker = new Worker<WebhookPayload>(
    "webhooks",
    async (job: Job<WebhookPayload>) => {
      log.info(
        { jobId: job.id, tenantId: job.data.tenantId },
        "Processing webhook job",
      );
      const payload = {
        id: job.id,
        timestamp: new Date().toISOString(),
        ...job.data,
      };
      const response = await fetch(MOCK_TENANT_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Webhook failed with status: ${response.status}`);
      }
      log.info({ jobId: job.id }, "Webhook delivered successfully");
    },
    { connection: getRedisConnectionOptions() as ConnectionOptions },
  );
  worker.on("completed", (job) => {
    log.info({ jobId: job.id }, "Webhook job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Webhook job failed");
  });

  worker.on("error", (err) => {
    log.error({ err }, "Webhook Worker encountered an error");
  });
  return worker;
};
