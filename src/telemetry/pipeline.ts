import type { RequestFeatures } from "../proxy/extractor.js";
import { enqueueForKafka } from "../kafka/producer.js";
import { enqueueRequestLog } from "./requestLogWriter.js";

/**
 * The single exit point for request telemetry. It never throws and never awaits
 * I/O, so nothing here can slow down or fail the request being proxied. The two
 * sinks are independent: analytics keep working while Kafka is down.
 */
export const emitTelemetry = (
  features: RequestFeatures,
  traceCarrier: Record<string, string> = {},
): void => {
  enqueueRequestLog(features);
  enqueueForKafka(features, traceCarrier);
};
