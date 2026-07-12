import { kafka } from "./client.js";
import type { RequestFeatures } from "../proxy/extractor.js";
import { propagation, context as otelContext } from "@opentelemetry/api";

export const producer = kafka.producer();
export const TRAFFIC_TOPIC = "gateway.traffic.logs";

export const connectProducer = async () => {
  try {
    await producer.connect();
    console.log("Kafka Producer connected securely.");
  } catch (error) {
    console.error("Failed to connect Kafka Producer:", error);
    process.exit(1);
  }
};

export const disconnectProducer = async () => {
  await producer.disconnect();
  console.log("Kafka Producer disconnected.");
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
    console.error("Failed to publish request log to Kafka:", error);
  }
};
