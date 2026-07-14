import { Hono } from "hono";
import { cors } from "hono/cors";
import healthRouter from "./routes/health.js";
import { db } from "./db/index.js";
import { tenants } from "./db/schema.js";
import { keysRouter } from "./routes/keys.js";
import gatewayRouter from "./routes/gateway.js";
import internalRouter from "./routes/internal.js";
import { register, metricsMiddleware } from "./monitoring/metrics.js";
import adminRouter from "./routes/admin.js";
import { rateLimiterMiddleware } from "./middleware/rateLimiter.js";
import { authMiddleware } from "./middleware/auth.js";
import authRouter from "./routes/auth.js";

const app = new Hono();
app.use(
  "*",
  cors({
    origin: "http://localhost:3001",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Metrics route
app.use("*", metricsMiddleware);

app.get("/metrics", async (c) => {
  c.header("Content-Type", register.contentType);
  return c.text(await register.metrics());
});

// Middleware for logging request time
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[${c.req.method}] ${c.req.url} - ${ms}ms`);
});

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

// Protected test route
app.post("/tenants", async (c) => {
  try {
    const body = await c.req.json();
    const { name, plan } = body;
    if (!name || !plan) {
      return c.json(
        {
          success: false,
          message: "Missing required fields",
        },
        400,
      );
    }
    const tenant = await db.insert(tenants).values({ name, plan }).returning();
    return c.json(
      {
        success: true,
        message: "Tenant created successfully",
        data: tenant,
      },
      201,
    );
  } catch (error) {
    console.error(error);
    return c.json(
      {
        success: false,
        message: "Failed to create tenant",
      },
      500,
    );
  }
});
// Test
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
      error: "Route not found",
      path: c.req.path,
    },
    404,
  );
});

// Global Error Handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500,
  );
});

export default app;
