import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
} from "prom-client";
import { createMiddleware } from "hono/factory";

export const register = new Registry();

collectDefaultMetrics({ register });

export const requestCounter = new Counter({
  name: "fluxgate_http_requests_total",
  help: "Total number of HTTP requests processed",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const requestLatencyHistogram = new Histogram({
  name: "fluxgate_http_request_duration_seconds",
  help: "Histogram of HTTP request durations",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

export const metricsMiddleware = createMiddleware(async (c, next) => {
  const startTimer = requestLatencyHistogram.startTimer();

  await next();

  const status = c.res.status || 200;
  const route = c.req.path || "unknown_route";
  const method = c.req.method || "unknown_method";

  requestCounter.inc({ method, route, status_code: status });
  startTimer({ method, route, status_code: status });
});
