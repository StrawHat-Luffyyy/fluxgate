import { Worker, type Job } from "bullmq";
import { getRedisConnectionOptions } from "./connection.js";
import type { ConnectionOptions } from "bullmq";
import type { WebhookPayload } from "./webhookQueue.js";

const MOCK_TENANT_WEBHOOK_URL = "https://webhook.site/9345eb90-7f3e-40f1-bc61-ff488a96f03f"

export const startWebhookWorker = () => {
  console.log("BullMQ Webhook Worker started....");

  const worker = new Worker<WebhookPayload>(
    "webhooks",
    async (job: Job<WebhookPayload>) => {
      console.log(
        `Processing Webhook Job ${job.id} for Tenant ${job.data.tenantId}...`,
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
      console.log(`Webhook delivered successfully for Job ${job.id}`);
    },
    { connection: getRedisConnectionOptions() as ConnectionOptions },
  );
  worker.on("completed", (job) => {
    console.log(`Webhook Job ${job.id} completed successfully.`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Webhook Job ${job?.id} failed: ${err.message}`);
  });

  worker.on("error", (err) => {
    console.error(`Webhook Worker encountered an error: ${err.message}`);
  });
  return worker;
};
