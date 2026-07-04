import { URL } from "node:url";
import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

export function getRedisConnectionOptions(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}


