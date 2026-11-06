// Runs before the e2e gateway starts. Each run signs up about a dozen workspaces, and
// the gateway allows 20 per IP per 15 minutes, so a second run soon after would be
// refused. This clears those counters and nothing else, and only in the logical Redis
// database the suite owns (see playwright.config.ts).
import { Redis } from "ioredis";

const url = new URL(process.env.REDIS_URL ?? "");
if (url.hostname !== "localhost" || url.pathname !== "/1") {
  throw new Error(`Refusing to touch ${url.hostname}${url.pathname}: expected localhost, database 1`);
}

const redis = new Redis(url.href);
const keys = await redis.keys("fluxgate:throttle:*");
if (keys.length > 0) await redis.del(...keys);
await redis.quit();
