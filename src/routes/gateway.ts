import { Hono } from "hono";
import { authMiddleware, type Env } from "../middleware/auth.js";
import { rateLimiterMiddleware } from "../middleware/rateLimiter.js";
import { telemetryMiddleware } from "../proxy/telemetry.js";
import { proxyHandler } from "../proxy/handler.js";

const gatewayRouter = new Hono<Env>();

// Order matters: telemetry needs the tenant set by auth, and must wrap the rate
// limiter so that 429s are recorded too.
gatewayRouter.use("*", authMiddleware, telemetryMiddleware, rateLimiterMiddleware());

gatewayRouter.all("/*", proxyHandler);

export default gatewayRouter;
