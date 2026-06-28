import { createMiddleware } from 'hono/factory';
import { redis } from '../redis/client.js';
import { SLIDING_WINDOW_LUA } from '../redis/scripts/slindingWindow.js';
import type { Env } from './auth.js'; 

const WINDOW_MS = 60 * 1000; // 60 seconds
const MAX_REQUESTS = 5;      // 5 requests per window 

export const rateLimiter = createMiddleware<Env>(async (c, next) => {
  const tenantId = c.get('tenantId');
  
  if (!tenantId) {
    return c.json({ error: 'Internal Server Error', message: 'Tenant context missing' }, 500);
  }

  const redisKey = `fluxgate:rl:${tenantId}`;
  const now = Date.now();
  // Generate a random string to prevent timestamp collisions in the Redis ZSET
  const ephemeralSalt = Math.random().toString(36).substring(2, 9);

  try {
    const result = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      redisKey,
      now,
      WINDOW_MS,
      MAX_REQUESTS,
      ephemeralSalt
    )) as [number, number];

    const [allowed, remaining] = result;

    // Attach standard RFC 6585 RateLimit Headers
    c.header('X-RateLimit-Limit', MAX_REQUESTS.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());

    if (allowed === 0) {
      return c.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again later.`,
        },
        429
      );
    }

    await next();
  } catch (err) {
    // FAIL OPEN STRATEGY
    console.error('RateLimiter Redis failure. Failing open to protect traffic:', err);
    await next();
  }
});