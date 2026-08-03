import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("tracing");

// Resource attributes (Service identity)
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "fluxgate-core-api",
  [ATTR_SERVICE_VERSION]: "1.0.0",
  environment: env.NODE_ENV,
});

// Configure OTLP Trace Exporter
const traceExporter = new OTLPTraceExporter({
  url: env.OTLP_ENDPOINT,
});

// Initialize OpenTelemetry SDK
export const otelSdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": {
        enabled: false,
      },
    }),
  ],
});

// Start tracing
export const startTracing = async () => {
  try {
    await otelSdk.start();
    log.info("OpenTelemetry Distributed Tracing initialized successfully");
  } catch (err) {
    log.error({ err }, "Failed to initialize OpenTelemetry");
  }
};
// Graceful shutdown
process.on("SIGTERM", async () => {
  try {
    await otelSdk.shutdown();
    log.info("OpenTelemetry SDK shut down successfully");
  } catch (err) {
    log.error({ err }, "Error shutting down OpenTelemetry SDK");
  } finally {
    process.exit(0);
  }
});
