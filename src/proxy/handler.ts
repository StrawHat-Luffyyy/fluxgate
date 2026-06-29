import type { Context } from "hono";
import { extractFeatures } from "./extractor.js";
import type { Env } from "../middleware/auth.js";

const UPSTREAM_TARGET = "https://jsonplaceholder.typicode.com";

export const proxyHandler = async (c: Context<Env>) => {
  const startTime = Date.now();
  const tenantId = c.get("tenantId");

  // e.g., /gateway/todos/1 -> /todos/1
  const incomingPath = c.req.path.replace(/^\/gateway/, "");
  const targetUrl = new URL(
    `${incomingPath}${c.req.header("x-original-search") || ""}`,
    UPSTREAM_TARGET,
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
    console.log("Extracted Request Features:", JSON.stringify(features));

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("x-powered-by"); // Security: Hide upstream tech stack (Express, PHP, etc.)
    responseHeaders.delete("server");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("Proxy Gateway Bad Gateway Error:", err);
    return c.json({
      error: "Bad Gateway",
      message: "Upstream service unreachable",
    } , 
  502);
  }
};
