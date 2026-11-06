import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { env } from "../config/env.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("tracing");

let sdk: NodeSDK | undefined;

/**
 * Registers the SDK so that manual spans and W3C propagation work. Automatic
 * library instrumentation is not used: it needs to load before the modules it
 * patches, which an ESM app importing them at the top of server.ts cannot do.
 */
export const startTracing = async () => {
  if (!env.OTEL_ENABLED) return;
  try {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "fluxgate-core-api",
        [ATTR_SERVICE_VERSION]: "1.0.0",
        environment: env.NODE_ENV,
      }),
      traceExporter: new OTLPTraceExporter({ url: env.OTLP_ENDPOINT }),
    });
    await sdk.start();
    log.info("OpenTelemetry tracing started");
  } catch (err) {
    log.error({ err }, "Failed to initialize OpenTelemetry");
  }
};

export const stopTracing = async () => {
  try {
    await sdk?.shutdown();
  } catch (err) {
    log.error({ err }, "Error shutting down OpenTelemetry SDK");
  }
};
