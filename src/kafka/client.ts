import { Kafka, logLevel } from "kafkajs";
import { env } from "../config/env.js";

export const kafka = new Kafka({
  clientId: "fluxgate-core",
  brokers: env.KAFKA_BROKER,
  // Telemetry is best effort, so fail quickly and let the producer's own
  // reconnect loop handle outages.
  connectionTimeout: 1_500,
  requestTimeout: 5_000,
  retry: { retries: 2, initialRetryTime: 100 },
  logLevel: logLevel.NOTHING,
});
