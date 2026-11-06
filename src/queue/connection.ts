import { URL } from "node:url";
import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

const baseOptions = () => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || "0"),
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
};

/** The worker should block and retry forever: BullMQ requires this setting. */
export const workerConnection = (): ConnectionOptions => ({
  ...baseOptions(),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as ConnectionOptions;

/** Producers should fail quickly during an outage: the outbox sweeper retries. */
export const producerConnection = (): ConnectionOptions => ({
  ...baseOptions(),
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
}) as ConnectionOptions;
