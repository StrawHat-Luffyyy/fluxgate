import { createMiddleware } from "hono/factory";
import type { Env } from "../middleware/auth.js";
import { clientIpOf } from "../lib/clientIp.js";
import { emitTelemetry } from "../telemetry/pipeline.js";
import { countingStream } from "./countingStream.js";
import { parseContentLength, type RequestFeatures } from "./extractor.js";
import { storableRoutePrefix } from "./path.js";

/**
 * Records every authenticated gateway request, including 429s and upstream
 * failures, once the response body has been fully sent. Sits after auth because
 * unauthenticated requests have no tenant to attribute them to.
 */
export const telemetryMiddleware = createMiddleware<Env>(async (c, next) => {
  const startedAt = Date.now();
  await next();
  const latencyMs = Date.now() - startedAt;

  const base: Omit<RequestFeatures, "responseByteSize" | "requestByteSize"> = {
    requestId: c.get("requestId"),
    tenantId: c.get("tenantId"),
    apiKeyId: c.get("apiKeyId"),
    method: c.req.method,
    path: c.req.path,
    routePrefix: storableRoutePrefix(c.req.path),
    clientIp: clientIpOf(c),
    statusCode: c.res.status,
    rateLimited: c.get("rateLimited") === true,
    upstreamCalled: c.get("upstreamCalled") === true,
    latencyMs,
    timestamp: startedAt,
  };
  const traceCarrier = c.get("traceCarrier");
  const emit = (responseByteSize: number) =>
    emitTelemetry(
      {
        ...base,
        // Counted when the body was forwarded, so a chunked upload is not recorded
        // as zero. The header only applies when the gateway answered without reading.
        requestByteSize: c.get("requestBytes") ?? parseContentLength(c.req.header("content-length")),
        responseByteSize,
      },
      traceCarrier,
    );

  const { body, status, headers } = c.res;
  // Hono runs HEAD as GET and discards the body, so a wrapped stream would never
  // be read and telemetry would never fire.
  if (!body || c.req.method === "HEAD") {
    emit(0);
    return;
  }
  c.res = new Response(countingStream(body, emit), { status, headers });
});
