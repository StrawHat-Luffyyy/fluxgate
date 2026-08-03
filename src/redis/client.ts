import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("redis");

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  log.error({ err }, "Redis connection error");
});
