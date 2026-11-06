import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { createMiddleware } from "hono/factory";

export const register = new Registry();

collectDefaultMetrics({ register });

const LABELS = ["method", "route", "status_code"];

export const requestCounter = new Counter({
  name: "fluxgate_http_requests_total",
  help: "Total number of HTTP requests processed",
  labelNames: LABELS,
  registers: [register],
});

export const requestLatencyHistogram = new Histogram({
  name: "fluxgate_http_request_duration_seconds",
  help: "Time until the response headers are ready",
  labelNames: LABELS,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const rateLimitRejections = new Counter({
  name: "fluxgate_rate_limit_rejections_total",
  help: "Requests rejected with 429 by the rate limiter",
  labelNames: ["strategy"],
  registers: [register],
});

export const rateLimitFailOpen = new Counter({
  name: "fluxgate_rate_limit_fail_open_total",
  help: "Requests let through because the rate limiter was unavailable",
  registers: [register],
});

export const kafkaPublishFailures = new Counter({
  name: "fluxgate_kafka_publish_failures_total",
  help: "Failed Kafka publish attempts (messages are requeued, see fluxgate_telemetry_dropped_total)",
  registers: [register],
});

export const telemetryDropped = new Counter({
  name: "fluxgate_telemetry_dropped_total",
  help: "Telemetry records discarded because a sink buffer was full",
  labelNames: ["sink"],
  registers: [register],
});

export const webhookQueueDepth = new Gauge({
  name: "fluxgate_webhook_queue_depth",
  help: "Webhook jobs in the queue, by state",
  labelNames: ["state"],
  registers: [register],
});

export const webhookDeliveries = new Counter({
  name: "fluxgate_webhook_deliveries_total",
  help: "Webhook delivery attempts, by outcome",
  labelNames: ["outcome"],
  registers: [register],
});

export const anomaliesRecorded = new Counter({
  name: "fluxgate_anomalies_recorded_total",
  help: "Anomalies stored from ai-service alerts, excluding redelivered duplicates",
  labelNames: ["detector"],
  registers: [register],
});

export const metricsMiddleware = createMiddleware(async (c, next) => {
  const endTimer = requestLatencyHistogram.startTimer();

  await next();

  // routePath is the matched pattern, e.g. "/gateway/*". The raw path would
  // create a new time series for every distinct URL.
  const labels = {
    method: c.req.method,
    route: c.req.routePath || "unmatched",
    status_code: c.res.status,
  };
  requestCounter.inc(labels);
  endTimer(labels);
});
