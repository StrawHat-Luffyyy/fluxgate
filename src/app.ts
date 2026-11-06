import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { env } from "./config/env.js";
import { createChildLogger } from "./lib/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { metricsMiddleware, register } from "./monitoring/metrics.js";
import adminRouter from "./routes/admin.js";
import analyticsRouter from "./routes/analytics.js";
import authRouter from "./routes/auth.js";
import gatewayRouter from "./routes/gateway.js";
import healthRouter from "./routes/health.js";
import internalRouter from "./routes/internal.js";
import { keysRouter } from "./routes/keys.js";
import teamRouter from "./routes/team.js";
import webhooksRouter from "./routes/webhooks.js";

const log = createChildLogger("http");

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

const app = new Hono<AppEnv>();

// --- Global Middleware Pipeline ---

const dashboardCors = cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});

// CORS applies to the dashboard API only. Proxied responses keep whatever CORS
// headers the upstream chose to send.
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/gateway")) return next();
  return dashboardCors(c, next);
});

// Always generated here, never accepted from the client: anomalies are unique per
// (tenant, requestId), so a client-chosen id could suppress a later alert.
app.use(
  "*",
  createMiddleware<AppEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    c.res.headers.set("X-Request-Id", requestId);
  }),
);

app.use("*", metricsMiddleware);

// These routes buffer the whole body before anything else can reject the request,
// including unauthenticated ones. /gateway streams, so the limit does not apply.
const limitDashboardBody = bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) =>
    c.json({ error: "PAYLOAD_TOO_LARGE", message: "Request body is too large" }, 413),
});
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/gateway")) return next();
  return limitDashboardBody(c, next);
});

app.get("/metrics", async (c) => {
  if (env.METRICS_TOKEN) {
    const provided = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${env.METRICS_TOKEN}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return c.json({ error: "Unauthorized", message: "Invalid metrics token" }, 401);
    }
  }
  c.header("Content-Type", register.contentType);
  return c.text(await register.metrics());
});

// Structured request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  log.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs: Date.now() - start,
      requestId: c.get("requestId"),
    },
    `${c.req.method} ${c.req.path}`,
  );
});

// --- Routes ---

app.route("/health", healthRouter);
app.route("/auth", authRouter);
app.route("/keys", keysRouter);
app.route("/team", teamRouter);
app.route("/admin", adminRouter);
app.route("/webhooks", webhooksRouter);
app.route("/analytics", analyticsRouter);
app.route("/internal", internalRouter);
app.route("/gateway", gatewayRouter);

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

app.onError(errorHandler);

export default app;
