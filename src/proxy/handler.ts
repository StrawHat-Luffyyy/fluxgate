import type { Context } from "hono";
import { extractFeatures } from "./extractor.js";
import type { Env } from "../middleware/auth.js";
import { redis } from "../redis/client.js";
import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { publishRequestLog } from "../kafka/producer.js";
import { propagation, context as otelContext, trace } from "@opentelemetry/api";
import { captureException } from "../monitoring/sentry.js";

export const proxyHandler = async (c: Context<Env>) => {
  const startTime = Date.now();
  const tenantId = c.get("tenantId");
  const tracer = trace.getTracer("fluxgate-proxy");

  return tracer.startActiveSpan("gateway.proxy_handler", async (span) => {
    let targetUrl: string | undefined;

    try {
      span.setAttribute("tenant.id", tenantId);
      span.setAttribute("http.method", c.req.method);
      span.setAttribute("http.path", c.req.path);

      const incomingPath = c.req.path.replace(/^\/gateway/, "");
      const pathSegments = incomingPath.split("/");
      const pathPrefix = `/${pathSegments[1] || ""}`;

      const cacheKey = `fluxgate:route:${tenantId}:${pathPrefix}`;
      let targetBaseUrl = await redis.get(cacheKey);

      if (!targetBaseUrl) {
        span.addEvent("cache_miss.querying_db");

        const [routeDef] = await db
          .select()
          .from(gatewayRoutes)
          .where(
            and(
              eq(gatewayRoutes.tenantId, tenantId),
              eq(gatewayRoutes.pathPrefix, pathPrefix),
            ),
          )
          .limit(1);

        if (!routeDef) {
          span.setAttribute("http.status_code", 404);

          return c.json(
            {
              error: "Not Found",
              message: `No upstream route configured for ${pathPrefix}`,
            },
            404,
          );
        }

        targetBaseUrl = routeDef.targetUrl;
        await redis.setex(cacheKey, 300, targetBaseUrl);
      }

      const remainingPath = incomingPath.replace(pathPrefix, "");

      targetUrl = new URL(
        `${remainingPath}${c.req.header("x-original-search") || ""}`,
        targetBaseUrl,
      ).toString();

      span.setAttribute("upstream.target_url", targetUrl);

      // Prepare upstream headers
      const upstreamHeaders = new Headers(c.req.raw.headers);
      upstreamHeaders.delete("host");
      upstreamHeaders.set("x-forwarded-by", "FluxGate-Core");
      upstreamHeaders.set("x-fluxgate-tenant", tenantId);

      // Inject W3C trace headers
      const carrier: Record<string, string> = {};
      propagation.inject(otelContext.active(), carrier);

      for (const [key, value] of Object.entries(carrier)) {
        upstreamHeaders.set(key, value);
      }

      const upstreamResponse = await fetch(targetUrl, {
        method: c.req.method,
        headers: upstreamHeaders,
        body:
          c.req.method === "GET" || c.req.method === "HEAD"
            ? null
            : c.req.raw.body,
        // @ts-expect-error Node fetch duplex option
        duplex: "half",
      });

      span.setAttribute("http.status_code", upstreamResponse.status);

      const responseByteSize = Number(
        upstreamResponse.headers.get("content-length") ?? 0,
      );

      const features = extractFeatures(
        c,
        tenantId,
        upstreamResponse.status,
        Number.isNaN(responseByteSize) ? 0 : responseByteSize,
        startTime,
      );

      // Fire-and-forget logging
      void publishRequestLog(features);

      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.delete("x-powered-by");
      responseHeaders.delete("server");

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    } catch (err) {
      span.recordException(err as Error);

      captureException(err, {
        tenantId,
        path: c.req.path,
        targetUrl,
      });

      return c.json(
        {
          error: "Bad Gateway",
          message: "Upstream service unreachable",
        },
        502,
      );
    } finally {
      span.end();
    }
  });
};
