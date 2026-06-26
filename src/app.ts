import { Hono } from "hono";
import healthRouter from "./routes/health.js";

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
