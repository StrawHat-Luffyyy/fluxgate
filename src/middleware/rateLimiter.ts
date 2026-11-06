import type { MiddlewareHandler } from "hono";
import { redis, type RateLimitResult } from "../redis/client.js";
import { createChildLogger } from "../lib/logger.js";
import { rateLimitFailOpen, rateLimitRejections } from "../monitoring/metrics.js";
import type { Env } from "./auth.js";

const log = createChildLogger("rate-limiter");

export type Strategy = "token_bucket" | "leaky_bucket" | "sliding_window";

export interface RateLimitConfig {
  strategy: Strategy;
  capacity: number;
  refillRate: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  strategy: "token_bucket",
  capacity: 100,
  refillRate: 20,
  windowMs: 60_000,
};

export type RateLimitConfigResolver = (tenantId: string) => Promise<RateLimitConfig>;

const evaluate = (key: string, config: RateLimitConfig): Promise<RateLimitResult> => {
  const capacity = config.capacity.toString();
  switch (config.strategy) {
    case "sliding_window":
      return redis.rlSlidingWindow(key, config.windowMs.toString(), capacity, crypto.randomUUID());
    case "leaky_bucket":
      return redis.rlLeakyBucket(key, capacity, config.refillRate.toString(), "1");
    case "token_bucket":
      return redis.rlTokenBucket(key, capacity, config.refillRate.toString(), "1");
  }
};

export const rateLimiterMiddleware = (
  resolveConfig: RateLimitConfigResolver = async () => DEFAULT_RATE_LIMIT,
): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) {
      return c.json(
        { error: "Unauthorized", message: "Missing tenant context." },
        401,
      );
    }

    // One bucket per tenant. Any client-controlled part of the path in this key
    // would hand out a fresh bucket per URL. Strategy is included because each
    // algorithm uses a different Redis type, and switching must not hit WRONGTYPE.
    let result: RateLimitResult;
    let config: RateLimitConfig;
    try {
      config = await resolveConfig(tenantId);
      const key = `fluxgate:rl:${tenantId}:${config.strategy}`;
      result = await evaluate(key, config);
    } catch (err) {
      // Deliberate: a cache outage must not become a gateway outage.
      log.error(
        { err, tenantId, mode: "fail-open" },
        "Rate limiter unavailable, failing open",
      );
      rateLimitFailOpen.inc();
      await next();
      // Set on the final response: c.header() before next() is lost when the
      // handler returns a raw Response, as the proxy does.
      c.res.headers.set("X-RateLimit-Fallback", "fail-open");
      return;
    }

    const [allowed, remaining, retryAfter] = result;
    const rateLimitHeaders = {
      "X-RateLimit-Limit": config.capacity.toString(),
      "X-RateLimit-Remaining": remaining.toString(),
      "X-RateLimit-Strategy": config.strategy,
    };

    if (!allowed) {
      const retryAfterSeconds =
        config.strategy === "sliding_window" ? retryAfter / 1000 : retryAfter;
      c.header("Retry-After", Math.max(1, Math.ceil(retryAfterSeconds)).toString());
      c.set("rateLimited", true);
      rateLimitRejections.inc({ strategy: config.strategy });
      return c.json(
        {
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please retry later.",
        },
        429,
        rateLimitHeaders,
      );
    }

    await next();
    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      c.res.headers.set(name, value);
    }
  };
};
