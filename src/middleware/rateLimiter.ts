import type { MiddlewareHandler } from "hono";
import { redis } from "../redis/client.js";
import { tokenBucketLua } from "../redis/scripts/tokenBucket.js";
import { leakyBucketLua } from "../redis/scripts/leakyBucket.js";
import { SLIDING_WINDOW_LUA } from "../redis/scripts/slindingWindow.js";
import { createChildLogger } from "../lib/logger.js";

import type { Env } from "./auth.js";

const log = createChildLogger("rate-limiter");

type Strategy = "token_bucket" | "leaky_bucket" | "sliding_window";

interface RateLimitConfig {
  strategy: Strategy;
  capacity: number;
  refillRate: number;
  windowMs: number;
}

type LuaResult = [number, number, number];

const DEFAULT_CONFIG: RateLimitConfig = {
  strategy: "token_bucket",
  capacity: 10,
  refillRate: 2,
  windowMs: 60_000,
};

const RATE_LIMIT_SCRIPTS = {
  token_bucket: tokenBucketLua,
  leaky_bucket: leakyBucketLua,
  sliding_window: SLIDING_WINDOW_LUA,
} as const;

export const rateLimiterMiddleware = (
  customConfig?: Partial<RateLimitConfig>,
): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const tenantId = c.get("tenantId");

    if (!tenantId) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Missing tenant context.",
        },
        401,
      );
    }

    const path = c.req.path;
    const config: RateLimitConfig = { ...DEFAULT_CONFIG, ...customConfig };
    const redisKey = `fluxgate:ratelimit:${tenantId}:${path}`;
    const script = RATE_LIMIT_SCRIPTS[config.strategy];

    try {
      let result: LuaResult;
      switch (config.strategy) {
        case "sliding_window": {
          result = (await redis.eval(
            script,
            1,
            redisKey,
            Date.now().toString(),
            config.windowMs.toString(),
            config.capacity.toString(),
            crypto.randomUUID(),
          )) as LuaResult;

          break;
        }

        case "token_bucket":
        case "leaky_bucket": {
          result = (await redis.eval(
            script,
            1,
            redisKey,
            config.capacity.toString(),
            config.refillRate.toString(),
            (Date.now() / 1000).toString(),
            "1",
          )) as LuaResult;

          break;
        }
      }

      const [allowed, remaining, retryAfter] = result;
      c.header("X-RateLimit-Limit", config.capacity.toString());
      c.header("X-RateLimit-Remaining", remaining.toString());
      c.header("X-RateLimit-Strategy", config.strategy);

      if (retryAfter > 0) {
        c.header(
          "Retry-After",
          Math.ceil(
            config.strategy === "sliding_window"
              ? retryAfter / 1000
              : retryAfter,
          ).toString(),
        );
      }

      if (!allowed) {
        return c.json(
          {
            error: "Too Many Requests",
            message: "Rate limit exceeded. Please retry later.",
          },
          429,
        );
      }

      await next();
    } catch (err) {
      log.error(
        { err, tenantId, path, mode: "fail-open" },
        "Redis rate limiter infrastructure failure — failing open to preserve gateway availability",
      );
      c.header("X-RateLimit-Fallback", "fail-open");
      await next();
    }
  };
};
