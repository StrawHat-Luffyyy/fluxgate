import { Hono } from "hono";
import { authMiddleware, type Env } from "../middleware/auth.js";
import { rateLimiterMiddleware } from "../middleware/rateLimiter.js";
import { proxyHandler } from "../proxy/handler.js";

const gatewayRouter = new Hono<Env>();

// Apply security & traffic control pipeline to all proxied traffic
gatewayRouter.use("*", authMiddleware, rateLimiterMiddleware());

// Wildcard catch-all: any HTTP method, any sub-path
gatewayRouter.all("/*", proxyHandler);

export default gatewayRouter;
