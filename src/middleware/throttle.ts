import { createMiddleware } from "hono/factory";
import { redis } from "../redis/client.js";
import { clientIpOf } from "../lib/clientIp.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("throttle");

/** Per-IP limit for unauthenticated endpoints such as login and signup. */
export const throttleByIp = (name: string, limit: number, windowMs: number) =>
  createMiddleware(async (c, next) => {
    const key = `fluxgate:throttle:${name}:${clientIpOf(c)}`;
    let allowed = 1;
    let retryAfterMs = 0;
    try {
      [allowed, , retryAfterMs] = await redis.rlSlidingWindow(
        key,
        windowMs.toString(),
        limit.toString(),
        crypto.randomUUID(),
      );
    } catch (err) {
      // Same availability trade-off as the gateway limiter; bcrypt still bounds
      // the guess rate per core.
      log.warn({ err, name }, "Throttle unavailable, failing open");
    }
    if (!allowed) {
      c.header("Retry-After", Math.max(1, Math.ceil(retryAfterMs / 1000)).toString());
      return c.json(
        { error: "TOO_MANY_REQUESTS", message: "Too many attempts. Please try again later." },
        429,
      );
    }
    await next();
  });
