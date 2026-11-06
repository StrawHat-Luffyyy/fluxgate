import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { rateLimitConfigs } from "../db/schema.js";
import { createChildLogger } from "../lib/logger.js";
import { DEFAULT_RATE_LIMIT, type RateLimitConfig } from "../middleware/rateLimiter.js";
import { cacheDel, cacheGet, cacheSet } from "../redis/cache.js";

const log = createChildLogger("rate-limit-config");

// Bounds how long a change can take to reach a node whose invalidation failed.
const CACHE_TTL_SECONDS = 60;
const cacheKey = (tenantId: string) => `fluxgate:rlcfg:${tenantId}`;

const readFromDb = async (tenantId: string): Promise<RateLimitConfig> => {
  const [row] = await db
    .select()
    .from(rateLimitConfigs)
    .where(eq(rateLimitConfigs.tenantId, tenantId))
    .limit(1);
  if (!row) return DEFAULT_RATE_LIMIT;
  return {
    strategy: row.strategy,
    capacity: row.capacity,
    refillRate: row.refillRate,
    windowMs: row.windowMs,
  };
};

// A short in-process layer in front of Redis. During a Redis outage the limiter
// fails open anyway, and this stops every request paying for a Postgres read first.
const LOCAL_TTL_MS = 5_000;
const LOCAL_MAX_ENTRIES = 10_000;
const local = new Map<string, { config: RateLimitConfig; expiresAt: number }>();

const remember = (tenantId: string, config: RateLimitConfig) => {
  if (local.size >= LOCAL_MAX_ENTRIES) local.clear();
  local.set(tenantId, { config, expiresAt: Date.now() + LOCAL_TTL_MS });
  return config;
};

/** Used on the hot path. Tenants without a saved config get the defaults. */
export const resolveRateLimitConfig = async (tenantId: string): Promise<RateLimitConfig> => {
  const entry = local.get(tenantId);
  if (entry && entry.expiresAt > Date.now()) return entry.config;

  const cached = await cacheGet(cacheKey(tenantId));
  if (cached) return remember(tenantId, JSON.parse(cached) as RateLimitConfig);

  try {
    const config = await readFromDb(tenantId);
    await cacheSet(cacheKey(tenantId), JSON.stringify(config), CACHE_TTL_SECONDS);
    return remember(tenantId, config);
  } catch (err) {
    // Redis may still be up, so enforcing the default limit beats enforcing none.
    log.warn({ err, tenantId }, "Could not load rate limit config, using defaults");
    return remember(tenantId, DEFAULT_RATE_LIMIT);
  }
};

export const getRateLimitConfig = (tenantId: string) => readFromDb(tenantId);

export const saveRateLimitConfig = async (tenantId: string, config: RateLimitConfig) => {
  await db
    .insert(rateLimitConfigs)
    .values({ tenantId, ...config })
    .onConflictDoUpdate({
      target: rateLimitConfigs.tenantId,
      set: { ...config, updatedAt: new Date() },
    });
  local.delete(tenantId);
  await cacheDel(cacheKey(tenantId));
  log.info({ tenantId, strategy: config.strategy, capacity: config.capacity }, "Rate limit updated");
  return config;
};
