import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../../src/redis/client.js", () => {
  const unavailable = () => Promise.reject(new Error("Connection is closed"));
  return {
    redis: {
      rlTokenBucket: unavailable,
      rlLeakyBucket: unavailable,
      rlSlidingWindow: unavailable,
    },
  };
});

import { rateLimitFailOpen } from "../../src/monitoring/metrics.js";
import { rateLimiterMiddleware } from "../../src/middleware/rateLimiter.js";

const buildApp = (handler = vi.fn(() => new Response("ok"))) => {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId" as never, "tenant" as never);
    await next();
  });
  app.use("*", rateLimiterMiddleware());
  app.get("/*", handler);
  return { app, handler };
};

describe("rate limiter when Redis is unavailable", () => {
  it("lets the request through and marks the response", async () => {
    const { app, handler } = buildApp();
    const before = (await rateLimitFailOpen.get()).values[0]?.value ?? 0;

    const res = await app.request("/gateway/x");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-fallback")).toBe("fail-open");
    expect(handler).toHaveBeenCalledOnce();
    expect((await rateLimitFailOpen.get()).values[0].value).toBe(before + 1);
  });

  it("does not swallow an error thrown by the downstream handler", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("tenantId" as never, "tenant" as never);
      await next();
    });
    app.use("*", rateLimiterMiddleware());
    const calls = vi.fn();
    app.get("/*", () => {
      calls();
      throw new Error("downstream failure");
    });
    app.onError((_, c) => c.text("handled", 500));

    const res = await app.request("/gateway/x");
    expect(res.status).toBe(500);
    expect(calls).toHaveBeenCalledOnce();
  });
});
