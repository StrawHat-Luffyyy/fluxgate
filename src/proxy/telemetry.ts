import { createMiddleware } from "hono/factory";
import type { Env } from "../middleware/auth.js";
import { clientIpOf } from "../lib/clientIp.js";
import { emitTelemetry } from "../telemetry/pipeline.js";
import { parseContentLength, type RequestFeatures } from "./extractor.js";
import { routePrefixOf } from "./path.js";

/**
 * Passes the body through unchanged while counting bytes. `onDone` runs once,
 * whether the stream finished, failed, or the client went away.
 */
const countingStream = (
  body: ReadableStream<Uint8Array>,
  onDone: (bytes: number) => void,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let bytes = 0;
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      onDone(bytes);
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        bytes += value.byteLength;
        controller.enqueue(value);
      } catch (err) {
        finish();
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
};

/**
 * Records every authenticated gateway request, including 429s and upstream
 * failures, once the response body has been fully sent. Sits after auth because
 * unauthenticated requests have no tenant to attribute them to.
 */
export const telemetryMiddleware = createMiddleware<Env>(async (c, next) => {
  const startedAt = Date.now();
  await next();
  const latencyMs = Date.now() - startedAt;

  const base: Omit<RequestFeatures, "responseByteSize"> = {
    requestId: c.get("requestId"),
    tenantId: c.get("tenantId"),
    apiKeyId: c.get("apiKeyId"),
    method: c.req.method,
    path: c.req.path,
    routePrefix: routePrefixOf(c.req.path),
    clientIp: clientIpOf(c),
    requestByteSize: parseContentLength(c.req.header("content-length")),
    statusCode: c.res.status,
    rateLimited: c.get("rateLimited") === true,
    upstreamCalled: c.get("upstreamCalled") === true,
    latencyMs,
    timestamp: startedAt,
  };
  const traceCarrier = c.get("traceCarrier");
  const emit = (responseByteSize: number) =>
    emitTelemetry({ ...base, responseByteSize }, traceCarrier);

  const { body, status, headers } = c.res;
  // Hono runs HEAD as GET and discards the body, so a wrapped stream would never
  // be read and telemetry would never fire.
  if (!body || c.req.method === "HEAD") {
    emit(0);
    return;
  }
  c.res = new Response(countingStream(body, emit), { status, headers });
});
