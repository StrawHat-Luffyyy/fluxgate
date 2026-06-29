import { Hono } from "hono";
import healthRouter from "./routes/health.js";
import { db } from "./db/index.js";
import { tenants } from "./db/schema.js";
import { keysRouter } from "./routes/keys.js";
import gatewayRouter from "./routes/gateway.js";

const app = new Hono();

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

// Wildcard proxy router
app.route("/gateway", gatewayRouter);
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
