import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app.js";
import {
  createApiKey,
  createTenant,
  resetState,
  startTestServer,
  type Session,
  type TestServer,
} from "./helpers.js";

describe("gateway request path", () => {
  let tenant: Session;
  let apiKey: { id: string; rawKey: string };
  let upstream: TestServer;

  const addRoute = async (pathPrefix: string, targetUrl: string) => {
    const res = await tenant.request("POST", "/admin/routes", { pathPrefix, targetUrl });
    expect(res.status).toBe(201);
  };

  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey.rawKey}`, ...init.headers },
    });

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant();
    apiKey = await createApiKey(tenant);
    upstream = await startTestServer((req, res) => {
      if (req.url.startsWith("/gzip")) {
        res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "text/plain" });
        res.end(gzipSync("decompressed body"));
      } else if (req.url.startsWith("/redirect")) {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url.startsWith("/slow")) {
        setTimeout(() => res.end("too late"), 3_000);
      } else {
        res.writeHead(200, { "Content-Type": "application/json", Server: "secret-server" });
        res.end(JSON.stringify({ url: req.url }));
      }
    });
    await addRoute("/svc", upstream.url);
  });

  afterEach(() => upstream.close());

  it("rejects a missing, unknown or revoked key", async () => {
    expect((await app.request("/gateway/svc")).status).toBe(401);
    const unknown = await app.request("/gateway/svc", {
      headers: { Authorization: "Bearer fg_live_unknown" },
    });
    expect(unknown.status).toBe(401);

    expect((await call("/gateway/svc")).status).toBe(200);
    await tenant.request("DELETE", `/keys/${apiKey.id}`);
    // Revocation clears the auth cache entry, so it applies immediately.
    expect((await call("/gateway/svc")).status).toBe(401);
  });

  it("stops the old key and starts the new one on rotation", async () => {
    expect((await call("/gateway/svc")).status).toBe(200);
    const res = await tenant.request("POST", `/keys/${apiKey.id}/rotate`);
    const { apiKey: newKey } = (await res.json()) as { apiKey: string };

    expect((await call("/gateway/svc")).status).toBe(401);
    const viaNew = await app.request("/gateway/svc", {
      headers: { Authorization: `Bearer ${newKey}` },
    });
    expect(viaNew.status).toBe(200);
  });

  it("forwards the real query string and ignores x-original-search", async () => {
    const res = await call("/gateway/svc/items?a=1&b=2", {
      headers: { "x-original-search": "?injected=1" },
    });
    expect(((await res.json()) as { url: string }).url).toBe("/items?a=1&b=2");
  });

  it("keeps the target URL's base path", async () => {
    await addRoute("/based", `${upstream.url}/v1/api`);
    const res = await call("/gateway/based/users/1");
    expect(((await res.json()) as { url: string }).url).toBe("/v1/api/users/1");
  });

  it("cannot be steered to another host with a double slash path", async () => {
    const res = await call("/gateway/svc//evil.example.com/steal");
    expect(res.status).toBe(200);
    expect(upstream.requests.at(-1)?.url).toBe("//evil.example.com/steal");
  });

  it("does not forward the gateway API key to the upstream", async () => {
    await call("/gateway/svc");
    expect(upstream.requests.at(-1)?.headers.authorization).toBeUndefined();
  });

  it("forwards X-Upstream-Authorization as Authorization", async () => {
    await call("/gateway/svc", { headers: { "X-Upstream-Authorization": "Bearer upstream" } });
    const headers = upstream.requests.at(-1)?.headers;
    expect(headers?.authorization).toBe("Bearer upstream");
    expect(headers?.["x-upstream-authorization"]).toBeUndefined();
  });

  it("does not forward the dashboard session cookie, and keeps other cookies", async () => {
    await call("/gateway/svc", { headers: { Cookie: "Fluxgate_session=secret; theme=dark" } });
    expect(upstream.requests.at(-1)?.headers.cookie).toBe("theme=dark");
    await call("/gateway/svc", { headers: { Cookie: "Fluxgate_session=secret" } });
    expect(upstream.requests.at(-1)?.headers.cookie).toBeUndefined();
  });

  it("does not pass a client-supplied X-Forwarded-For through", async () => {
    await call("/gateway/svc", { headers: { "X-Forwarded-For": "1.2.3.4" } });
    expect(upstream.requests.at(-1)?.headers["x-forwarded-for"]).toBeUndefined();
  });

  it("accepts a request with Expect: 100-continue", async () => {
    const res = await call("/gateway/svc/items", {
      method: "POST",
      headers: { Expect: "100-continue" },
      body: "x",
    });
    expect(res.status).toBe(200);
  });

  it("rejects an oversized body on dashboard routes before auth", async () => {
    const res = await app.request("/internal/alerts", {
      method: "POST",
      headers: { "Content-Length": String(1024 * 1024) },
      body: "x".repeat(1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it("overwrites a client-supplied tenant header", async () => {
    await call("/gateway/svc", { headers: { "X-FluxGate-Tenant": "spoofed" } });
    expect(upstream.requests.at(-1)?.headers["x-fluxgate-tenant"]).toBe(tenant.tenantId);
  });

  it("passes request bodies through", async () => {
    await call("/gateway/svc/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    const last = upstream.requests.at(-1);
    expect(last?.method).toBe("POST");
    expect(last?.body).toBe('{"hello":"world"}');
  });

  it("returns a gzip upstream's body decoded, without a stale Content-Encoding", async () => {
    const res = await call("/gateway/svc/gzip");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("decompressed body");
  });

  it("strips identifying upstream headers", async () => {
    const res = await call("/gateway/svc");
    expect(res.headers.get("server")).toBeNull();
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns a redirect to the client instead of following it", async () => {
    const res = await call("/gateway/svc/redirect");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("169.254.169.254");
  });

  it("returns 504 when the upstream exceeds the timeout", async () => {
    const res = await call("/gateway/svc/slow");
    expect(res.status).toBe(504);
  });

  it("returns 502 when the upstream is unreachable", async () => {
    await addRoute("/down", "http://127.0.0.1:59999");
    expect((await call("/gateway/down")).status).toBe(502);
  });

  it("returns 404 for an unconfigured prefix", async () => {
    expect((await call("/gateway/nope")).status).toBe(404);
  });

  it("applies a route change immediately despite the route cache", async () => {
    await call("/gateway/svc");
    const other = await startTestServer((_, res) => res.end("other"));
    try {
      const list = await tenant.request("GET", "/admin/routes");
      const { routes } = (await list.json()) as { routes: { id: string }[] };
      await tenant.request("PATCH", `/admin/routes/${routes[0].id}`, { targetUrl: other.url });
      expect(await (await call("/gateway/svc")).text()).toBe("other");
    } finally {
      await other.close();
    }
  });

  it("rejects a duplicate prefix with 409 and a multi-segment prefix with 400", async () => {
    const duplicate = await tenant.request("POST", "/admin/routes", {
      pathPrefix: "svc",
      targetUrl: upstream.url,
    });
    expect(duplicate.status).toBe(409);
    const nested = await tenant.request("POST", "/admin/routes", {
      pathPrefix: "/a/b",
      targetUrl: upstream.url,
    });
    expect(nested.status).toBe(400);
  });

  describe("rate limiting", () => {
    it("rejects with 429 and rate limit headers, and shares a bucket across paths", async () => {
      let rejected: Response | undefined;
      // Default capacity is 100. Varying the path must not create new buckets.
      for (let i = 0; i < 150 && !rejected; i++) {
        // Varying the first segment too: unknown prefixes must spend the same bucket.
        const res = await call(i % 2 ? `/gateway/svc/item-${i}` : `/gateway/unknown-${i}`);
        if (res.status === 429) rejected = res;
        else await res.text();
      }
      expect(rejected).toBeDefined();
      expect(rejected?.headers.get("retry-after")).toBeTruthy();
      expect(rejected?.headers.get("x-ratelimit-strategy")).toBe("token_bucket");
      expect(rejected?.headers.get("x-ratelimit-remaining")).toBe("0");
    });

    it("adds rate limit headers to successful proxied responses", async () => {
      const res = await call("/gateway/svc");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-ratelimit-limit")).toBe("100");
      expect(res.headers.get("x-ratelimit-strategy")).toBe("token_bucket");
    });
  });
});
