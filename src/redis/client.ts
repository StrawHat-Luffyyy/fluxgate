import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";
import { tokenBucketLua } from "./scripts/tokenBucket.js";
import { leakyBucketLua } from "./scripts/leakyBucket.js";
import { slidingWindowLua } from "./scripts/slidingWindow.js";

const log = createChildLogger("redis");

export type RateLimitResult = [allowed: number, remaining: number, retryAfter: number];

type RateLimitCommands = {
  rlTokenBucket(key: string, capacity: string, refillRate: string, requested: string): Promise<RateLimitResult>;
  rlLeakyBucket(key: string, capacity: string, leakRate: string, requested: string): Promise<RateLimitResult>;
  rlSlidingWindow(key: string, windowMs: string, limit: string, requestId: string): Promise<RateLimitResult>;
};

const client = new Redis(env.REDIS_URL, {
  // The gateway must stay fast during a Redis outage, so commands fail
  // immediately instead of queueing behind a reconnect.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
  retryStrategy: (times) => Math.min(times * 100, 2_000),
});

// defineCommand uses EVALSHA and falls back to EVAL when the script is unknown.
client.defineCommand("rlTokenBucket", { numberOfKeys: 1, lua: tokenBucketLua });
client.defineCommand("rlLeakyBucket", { numberOfKeys: 1, lua: leakyBucketLua });
client.defineCommand("rlSlidingWindow", { numberOfKeys: 1, lua: slidingWindowLua });

let lastErrorLoggedAt = 0;
client.on("error", (err) => {
  // ioredis emits on every failed reconnect; one line every 30s is enough.
  if (Date.now() - lastErrorLoggedAt > 30_000) {
    lastErrorLoggedAt = Date.now();
    log.error({ err }, "Redis connection error");
  }
});

export const redis = client as Redis & RateLimitCommands;
