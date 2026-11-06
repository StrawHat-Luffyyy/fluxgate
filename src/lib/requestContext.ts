import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export interface RequestContext {
  requestId: string;
  traceId: string;
  /** W3C header value passed on to the upstream, Kafka and the webhook queue. */
  traceparent: string;
  tracestate?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

// Version ff is forbidden by the W3C spec, as are all-zero ids.
const TRACEPARENT = /^(?!ff)[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ALL_ZEROS = /^0+$/;
const MAX_TRACESTATE_LENGTH = 512; // The W3C limit.

const isValidTraceparent = (value: string): boolean => {
  const match = TRACEPARENT.exec(value);
  return match !== null && !ALL_ZEROS.test(match[1]) && !ALL_ZEROS.test(match[2]);
};

/**
 * Trace ids exist even with OpenTelemetry off, so logs always correlate across the
 * gateway, the consumer and the webhook worker. A valid `inbound` traceparent is
 * continued; anything else starts a new trace. Callers pass `inbound` only for a
 * sender they trust: the format check stops log injection, but a client choosing its
 * own trace id could join its logs to another tenant's, or turn off sampling.
 */
export const createRequestContext = (
  requestId: string,
  inbound?: { traceparent?: string | null; tracestate?: string | null },
): RequestContext => {
  const traceparent = inbound?.traceparent?.trim().toLowerCase();
  if (traceparent && isValidTraceparent(traceparent)) {
    return {
      requestId,
      traceId: traceparent.split("-")[1],
      traceparent,
      ...(inbound?.tracestate && inbound.tracestate.length <= MAX_TRACESTATE_LENGTH
        ? { tracestate: inbound.tracestate }
        : {}),
    };
  }
  const traceId = randomBytes(16).toString("hex");
  return {
    requestId,
    traceId,
    // Flag 01 (sampled): with OpenTelemetry on, 00 would make its parent-based
    // sampler drop every span in the trace.
    traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01`,
  };
};

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const currentRequestContext = (): RequestContext | undefined => storage.getStore();

/** Headers that carry the current trace to another process. */
export const currentTraceHeaders = (): Record<string, string> => {
  const context = storage.getStore();
  if (!context) return {};
  return {
    traceparent: context.traceparent,
    ...(context.tracestate ? { tracestate: context.tracestate } : {}),
  };
};
