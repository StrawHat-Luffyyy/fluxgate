import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import healthRouter from "./routes/health.js";
import { keysRouter } from "./routes/keys.js";
import gatewayRouter from "./routes/gateway.js";
import internalRouter from "./routes/internal.js";
import { register, metricsMiddleware } from "./monitoring/metrics.js";
import adminRouter from "./routes/admin.js";
import { rateLimiterMiddleware } from "./middleware/rateLimiter.js";
import { authMiddleware } from "./middleware/auth.js";
import authRouter from "./routes/auth.js";
import analyticsRouter from "./routes/analytics.js";
import tenantsRouter from "./routes/tenants.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createChildLogger } from "./lib/logger.js";

const log = createChildLogger("http");

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

const app = new Hono<AppEnv>();

// --- Global Middleware Pipeline ---

// CORS (credentials: true preserved for HttpOnly cookie auth flow)
app.use(
  "*",
  cors({
    origin: "http://localhost:3001",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Request ID injection
app.use(
  "*",
  createMiddleware<AppEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  }),
);

// Prometheus metrics
app.use("*", metricsMiddleware);

app.get("/metrics", async (c) => {
  c.header("Content-Type", register.contentType);
  return c.text(await register.metrics());
});

// Structured request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs: ms,
      requestId: c.get("requestId"),
    },
    `${c.req.method} ${c.req.path}`,
  );
});

// --- Routes ---

// Health route
app.route("/health", healthRouter);

// Keys route
app.route("/keys", keysRouter);
app.route("/api/keys", keysRouter);

// Wildcard proxy router
app.route("/gateway", gatewayRouter);

// Internal routes
app.route("/internal", internalRouter);

// Admin routes
app.route("/admin", adminRouter);

// Auth routes
app.route("/auth", authRouter);

// Analytics routes
app.route("/analytics", analyticsRouter);

// Tenants route (extracted from inline handler)
app.route("/tenants", tenantsRouter);

// Protected test route
app.get("/test-rate-limit", authMiddleware, rateLimiterMiddleware(), (c) =>
  c.json({
    success: true,
  }),
);

app.get("/debug-sentry", () => {
  throw new Error("Test Sentry Distributed Trace Exception");
});

// Custom 404 Handler
app.notFound((c) => {
  return c.json(
    {
      error: "NOT_FOUND",
      message: "Route not found",
      path: c.req.path,
      requestId: c.get("requestId"),
    },
    404,
  );
});

// Centralized Error Handler
app.onError(errorHandler);

export default app;
