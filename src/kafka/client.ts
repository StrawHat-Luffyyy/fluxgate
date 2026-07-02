import { logLevel, Kafka } from "kafkajs";
import { env } from "../config/env.js";

export const kafka = new Kafka({
  clientId: "fluxgate-core",
  brokers: [env.KAFKA_BROKER],
  logLevel: logLevel.ERROR,
});
