import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./connection.js";

export interface WebhookPayload {
  tenantId: string;
  alertType: string;
  message: string;
  data: Record<string, any>;
}

export const webhookQueue = new Queue<WebhookPayload>("webhooks", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

