import { Partitioners, type Message } from "kafkajs";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";
import { kafkaPublishFailures, telemetryDropped } from "../monitoring/metrics.js";
import type { RequestFeatures } from "../proxy/extractor.js";
import { kafka } from "./client.js";

const log = createChildLogger("kafka-producer");

const MAX_BUFFERED_MESSAGES = 10_000;
const MAX_BATCH_SIZE = 1_000;
const FLUSH_INTERVAL_MS = 200;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STOP_FLUSH_TIMEOUT_MS = 3_000;

export type KafkaStatus = "connected" | "connecting" | "disconnected";

const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

let status: KafkaStatus = "disconnected";
let stopping = false;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let flushing: Promise<void> | undefined;
let buffer: Message[] = [];

const connect = async () => {
  if (stopping || status === "connected" || status === "connecting") return;
  status = "connecting";
  try {
    await producer.connect();
  } catch (err) {
    status = "disconnected";
    const delay = Math.min(1_000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    reconnectAttempt += 1;
    if (reconnectAttempt === 1 || delay === MAX_RECONNECT_DELAY_MS) {
      log.warn({ err, retryInMs: delay }, "Kafka unavailable, telemetry is degraded");
    }
    reconnectTimer = setTimeout(() => void connect(), delay);
    reconnectTimer.unref();
  }
};

producer.on(producer.events.CONNECT, () => {
  status = "connected";
  reconnectAttempt = 0;
  log.info("Kafka producer connected");
});

/** Puts unsent messages back in front, then enforces the cap by dropping oldest. */
const requeue = (batch: Message[]) => {
  buffer = batch.concat(buffer);
  const excess = buffer.length - MAX_BUFFERED_MESSAGES;
  if (excess > 0) {
    buffer = buffer.slice(excess);
    telemetryDropped.inc({ sink: "kafka" }, excess);
  }
};

const flush = async () => {
  if (status !== "connected" || buffer.length === 0) return;
  const batch = buffer.slice(0, MAX_BATCH_SIZE);
  buffer = buffer.slice(batch.length);
  try {
    await producer.send({ topic: env.KAFKA_TOPIC, messages: batch });
  } catch (err) {
    requeue(batch);
    kafkaPublishFailures.inc();
    log.warn({ err, buffered: buffer.length }, "Kafka publish failed, reconnecting");
    // kafkajs only emits DISCONNECT for an explicit disconnect, not for a lost
    // broker, so a failed send is the signal that the connection is gone.
    status = "disconnected";
    await producer.disconnect().catch(() => {});
    if (!stopping) void connect();
  }
};

const drain = async () => {
  while (status === "connected" && buffer.length > 0) await flush();
};

const scheduledFlush = () => {
  if (!flushing) {
    flushing = drain().finally(() => {
      flushing = undefined;
    });
  }
};

/**
 * Starts connecting in the background and returns immediately: the gateway has
 * to serve traffic whether or not Kafka is reachable.
 */
export const startProducer = () => {
  stopping = false;
  void connect();
  flushTimer = setInterval(scheduledFlush, FLUSH_INTERVAL_MS);
  flushTimer.unref();
};

export const stopProducer = async () => {
  stopping = true;
  clearInterval(flushTimer);
  clearTimeout(reconnectTimer);
  await flushing;
  // A failed send clears `connected`, and the deadline covers a slow broker, so
  // a dead Kafka cannot use up the whole shutdown budget.
  const deadline = Date.now() + STOP_FLUSH_TIMEOUT_MS;
  while (status === "connected" && buffer.length > 0 && Date.now() < deadline) await flush();
  status = "disconnected";
  await producer.disconnect().catch(() => {});
};

/** Never blocks and never throws. A full buffer drops the oldest message. */
export const enqueueForKafka = (
  features: RequestFeatures,
  traceCarrier: Record<string, string> = {},
): void => {
  if (buffer.length >= MAX_BUFFERED_MESSAGES) {
    buffer.shift();
    telemetryDropped.inc({ sink: "kafka" });
  }
  buffer.push({
    key: features.tenantId,
    value: JSON.stringify(features),
    headers: traceCarrier,
  });
};

/** For tests: runs one flush now instead of waiting for the timer. */
export const flushKafkaNow = () => flush();

export const getKafkaHealth = () => ({ status, buffered: buffer.length });
