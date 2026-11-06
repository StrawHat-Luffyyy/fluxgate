import { redis } from "./client.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("redis-cache");

// Redis is an optimisation for these lookups, never a dependency: every helper
// treats failure as a cache miss so that callers fall back to Postgres.

export const cacheGet = async (key: string): Promise<string | null> => {
  try {
    return await redis.get(key);
  } catch (err) {
    log.debug({ err, key }, "Cache read failed");
    return null;
  }
};

export const cacheSet = async (key: string, value: string, ttlSeconds: number) => {
  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch (err) {
    log.debug({ err, key }, "Cache write failed");
  }
};

export const cacheDel = async (...keys: string[]) => {
  try {
    await redis.del(...keys);
  } catch (err) {
    // A failed invalidation leaves a stale entry until its TTL expires. All TTLs
    // are short for this reason, and the failure is worth a warning.
    log.warn({ err, keys }, "Cache invalidation failed");
  }
};
