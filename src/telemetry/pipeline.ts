import type { RequestFeatures } from "../proxy/extractor.js";
import { enqueueForKafka } from "../kafka/producer.js";

/**
 * The single exit point for request telemetry. It never throws and never awaits
 * I/O, so nothing here can slow down or fail the request being proxied.
 */
export const emitTelemetry = (
  features: RequestFeatures,
  traceCarrier: Record<string, string> = {},
): void => {
  enqueueForKafka(features, traceCarrier);
};
