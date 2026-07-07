import type { Context } from "hono";
import { extractFeatures } from "./extractor.js";
import type { Env } from "../middleware/auth.js";
import { redis } from "../redis/client.js";
import { db } from "../db/index.js";
import { gatewayRoutes } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { publishRequestLog } from "../kafka/producer.js";

export const proxyHandler = async (c: Context<Env>) => {
  const startTime = Date.now();
  const tenantId = c.get("tenantId");

  // e.g., /gateway/todos/1 -> /todos/1
  const incomingPath = c.req.path.replace(/^\/gateway/, "");
  const pathSegments = incomingPath.split("/");
  const pathPrefix = `/${pathSegments[1] || ""}`.trim();

  const cacheKey = `fluxgate:route:${tenantId}:${pathPrefix}`;
  let targetBaseUrl = await redis.get(cacheKey);

  if (!targetBaseUrl) {
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
      return c.json(
        {
          error: "Not Found",
          message: `No upstream route configured for path prefix ${pathPrefix}`,
        },
        404,
      );
    }
    targetBaseUrl = routeDef.targetUrl;

    await redis.setex(cacheKey, 300, targetBaseUrl);
  }

  const remainingPath = incomingPath.replace(pathPrefix, "");
  // Remove leading slash from remainingPath to prevent stripping the path component of targetBaseUrl
  const relativePath = remainingPath.startsWith("/") ? remainingPath.slice(1) : remainingPath;
  const base = targetBaseUrl.endsWith("/") ? targetBaseUrl : `${targetBaseUrl}/`;

  const targetUrl = new URL(
    `${relativePath}${c.req.header("x-original-search") || ""}`,
    base,
  ).toString();

  // Sanitize headers
  const upstreamHeaders = new Headers(c.req.raw.headers);
  upstreamHeaders.delete("host"); // Strip original host to prevent SSL/SNI routing errors upstream
  upstreamHeaders.set("x-forwarded-by", "FluxGate-Core");
  upstreamHeaders.set("x-fluxgate-tenant", tenantId);

  try {
    // Stream the request upstream using standard web fetch API
    const upstreamResponse = await fetch(targetUrl, {
      method: c.req.method,
      headers: upstreamHeaders,
      body: ["GET", "HEAD"].includes(c.req.method) ? null : c.req.raw.body, // Pass the raw body stream directly. Null for GET/HEAD requests.
      duplex: "half", // @ts-ignore - Node fetch implementation detail: prevents duplicate duplex errors
    } as RequestInit & { duplex: "half" });

    const resContentLength = upstreamResponse.headers.get("content-length");
    const responseByteSize = resContentLength
      ? parseInt(resContentLength, 10)
      : 0;

    const features = extractFeatures(
      c,
      tenantId,
      upstreamResponse.status,
      isNaN(responseByteSize) ? 0 : responseByteSize,
      startTime,
    );
    await publishRequestLog(features).catch(console.error);
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("x-powered-by"); // Security: Hide upstream tech stack (Express, PHP, etc.)
    responseHeaders.delete("server");
    responseHeaders.delete("content-encoding"); // Decompression is handled by Node fetch, so strip this to prevent client decoding errors
    responseHeaders.delete("content-length");   // Length changes post-decompression, so let Hono recalculate it

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("Proxy Gateway Bad Gateway Error:", err);
    return c.json(
      {
        error: "Bad Gateway",
        message: "Upstream service unreachable",
      },
      502,
    );
  }
};
