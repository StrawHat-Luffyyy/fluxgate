import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { context as otelContext, propagation, trace } from "@opentelemetry/api";
import { errors as undiciErrors } from "undici";
import type { Env } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { cacheGet, cacheSet } from "../redis/cache.js";
import { AppError } from "../lib/AppError.js";
import { BlockedTargetError, guardedFetch } from "../lib/ssrf.js";
import { clientIpOf } from "../lib/clientIp.js";
import { SESSION_COOKIE } from "../middleware/dashBoardAuth.js";
import { captureException } from "../monitoring/sentry.js";
import { buildUpstreamUrl, remainingPathOf, routePrefixOf } from "./path.js";

const ROUTE_CACHE_TTL_SECONDS = 300;
export const routeCacheKey = (tenantId: string, pathPrefix: string) =>
  `fluxgate:route:${tenantId}:${pathPrefix}`;

// Hop-by-hop headers apply to one connection only (RFC 9110 section 7.6.1).
const HOP_BY_HOP = [
  "connection",
  "expect", // Node has already answered 100 Continue; undici refuses the header.
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const resolveTarget = async (tenantId: string, pathPrefix: string): Promise<string | null> => {
  const cacheKey = routeCacheKey(tenantId, pathPrefix);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const [route] = await db
    .select({ targetUrl: gatewayRoutes.targetUrl })
    .from(gatewayRoutes)
    .where(
      and(
        eq(gatewayRoutes.tenantId, tenantId),
        eq(gatewayRoutes.pathPrefix, pathPrefix),
      ),
    )
    .limit(1);
  if (!route) return null;

  await cacheSet(cacheKey, route.targetUrl, ROUTE_CACHE_TTL_SECONDS);
  return route.targetUrl;
};

const buildUpstreamHeaders = (c: Context<Env>, tenantId: string): Headers => {
  const headers = new Headers(c.req.raw.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  headers.delete("host");

  // The FluxGate API key authenticates the caller to the gateway and must not
  // leak to the upstream. Clients that need upstream auth send it separately.
  const upstreamAuth = headers.get("x-upstream-authorization");
  headers.delete("authorization");
  headers.delete("x-upstream-authorization");
  if (upstreamAuth) headers.set("authorization", upstreamAuth);

  // The dashboard session is host-wide, so a browser on the same site sends it here.
  const cookie = headers.get("cookie");
  if (cookie) {
    const kept = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.startsWith(`${SESSION_COOKIE}=`));
    if (kept.length > 0) headers.set("cookie", kept.join("; "));
    else headers.delete("cookie");
  }

  // Set rather than passed through: a client-supplied value could spoof an
  // upstream that trusts this header.
  const clientIp = clientIpOf(c);
  if (clientIp === "unknown") headers.delete("x-forwarded-for");
  else headers.set("x-forwarded-for", clientIp);

  headers.set("x-forwarded-by", "FluxGate-Core");
  headers.set("x-fluxgate-tenant", tenantId);
  headers.set("x-request-id", c.get("requestId"));

  // Kept for telemetry, which is emitted after this span has ended.
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier);
  c.set("traceCarrier", carrier);
  for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
  return headers;
};

const buildResponseHeaders = (upstream: Headers): Headers => {
  const headers = new Headers(upstream);
  for (const name of HOP_BY_HOP) headers.delete(name);
  // fetch has already decompressed the body, so these would now describe the
  // wrong bytes and the client would fail to decode the response.
  if (headers.has("content-encoding")) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  headers.delete("x-powered-by");
  headers.delete("server");
  return headers;
};

const isTimeout = (err: unknown): boolean => {
  const cause = (err as { cause?: unknown }).cause;
  return (
    cause instanceof undiciErrors.HeadersTimeoutError ||
    cause instanceof undiciErrors.BodyTimeoutError ||
    cause instanceof undiciErrors.ConnectTimeoutError
  );
};

const isBlocked = (err: unknown): boolean =>
  err instanceof BlockedTargetError ||
  (err as { cause?: unknown }).cause instanceof BlockedTargetError;

export const proxyHandler = async (c: Context<Env>) => {
  const tenantId = c.get("tenantId");
  const tracer = trace.getTracer("fluxgate-proxy");

  return tracer.startActiveSpan("gateway.proxy_handler", async (span) => {
    let upstreamUrl: string | undefined;

    try {
      span.setAttribute("tenant.id", tenantId);
      span.setAttribute("http.method", c.req.method);

      const pathPrefix = routePrefixOf(c.req.path);
      const targetBaseUrl = await resolveTarget(tenantId, pathPrefix);
      if (!targetBaseUrl) {
        span.setAttribute("http.status_code", 404);
        return c.json(
          {
            error: "Not Found",
            message: `No upstream route configured for ${pathPrefix}`,
          },
          404,
        );
      }

      upstreamUrl = buildUpstreamUrl(
        targetBaseUrl,
        remainingPathOf(c.req.path),
        new URL(c.req.url).search,
      );
      // Path only: query strings can carry tokens, and this goes to external tools.
      span.setAttribute("upstream.target_url", upstreamUrl.split("?")[0]);

      const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
      const upstream = await guardedFetch(upstreamUrl, {
        method: c.req.method,
        headers: Object.fromEntries(buildUpstreamHeaders(c, tenantId)),
        body: hasBody ? c.req.raw.body : null,
        signal: c.req.raw.signal,
        ...(hasBody ? { duplex: "half" as const } : {}),
      });

      span.setAttribute("http.status_code", upstream.status);
      c.set("upstreamCalled", true);

      return new Response(upstream.body as ReadableStream | null, {
        status: upstream.status,
        headers: buildResponseHeaders(upstream.headers as unknown as Headers),
      });
    } catch (err) {
      if (err instanceof AppError) throw err;

      span.recordException(err as Error);
      if (isBlocked(err)) {
        return c.json(
          { error: "Bad Gateway", message: "Upstream target is not allowed" },
          502,
        );
      }
      if (isTimeout(err)) {
        return c.json(
          { error: "Gateway Timeout", message: "Upstream service timed out" },
          504,
        );
      }
      captureException(err, { tenantId, path: c.req.path, upstream: upstreamUrl?.split("?")[0] });
      return c.json(
        { error: "Bad Gateway", message: "Upstream service unreachable" },
        502,
      );
    } finally {
      span.end();
    }
  });
};
