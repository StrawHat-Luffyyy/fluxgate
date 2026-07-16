import { kafka } from "./client.js";
import type { RequestFeatures } from "../proxy/extractor.js";
import { propagation, context as otelContext } from "@opentelemetry/api";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("kafka-producer");

export const producer = kafka.producer();
export const TRAFFIC_TOPIC = "gateway.traffic.logs";

export const connectProducer = async () => {
  try {
    await producer.connect();
    log.info("Kafka Producer connected securely");
  } catch (error) {
    log.fatal({ err: error }, "Failed to connect Kafka Producer");
    process.exit(1);
  }
};

export const disconnectProducer = async () => {
  await producer.disconnect();
  log.info("Kafka Producer disconnected");
};

/**
 * Publishes the extracted request features to the Kafka stream.
 */
export const publishRequestLog = async (features: RequestFeatures) => {
  try {
    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier);

    const kafkaHeaders: Record<string, Buffer> = {};
    Object.entries(carrier).forEach(([key, value]) => {
      kafkaHeaders[key] = Buffer.from(value);
    });
    await producer.send({
      topic: TRAFFIC_TOPIC,
      messages: [
        {
          key: features.tenantId,
          value: JSON.stringify(features),
          headers: kafkaHeaders,
        },
      ],
    });
  } catch (error) {
    log.error({ err: error, tenantId: features.tenantId }, "Failed to publish request log to Kafka");
  }
};
