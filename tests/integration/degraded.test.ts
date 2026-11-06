import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";
import { redis } from "../../src/redis/client.js";
import {
  createApiKey,
  createTenant,
  resetState,
  startTestServer,
  type Session,
  type TestServer,
} from "./helpers.js";

// Real Postgres and upstream, with Redis calls failing the way a dropped
// connection makes them fail.
describe("gateway with Redis unavailable", () => {
  let tenant: Session;
  let apiKey: { rawKey: string };
  let upstream: TestServer;

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant();
    apiKey = await createApiKey(tenant);
    upstream = await startTestServer((_, res) => res.end("served"));
    await tenant.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstream.url });

    const fail = () => Promise.reject(new Error("Connection is closed"));
    vi.spyOn(redis, "get").mockImplementation(fail);
    vi.spyOn(redis, "set").mockImplementation(fail);
    vi.spyOn(redis, "ping").mockImplementation(fail);
    vi.spyOn(redis, "rlTokenBucket").mockImplementation(fail);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await upstream.close();
  });

  it("still authenticates, resolves the route from Postgres and proxies", async () => {
    const res = await app.request("/gateway/svc", {
      headers: { Authorization: `Bearer ${apiKey.rawKey}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("served");
    expect(res.headers.get("x-ratelimit-fallback")).toBe("fail-open");
  });

  it("still rejects an invalid key: failing open applies to limits, not auth", async () => {
    const res = await app.request("/gateway/svc", {
      headers: { Authorization: "Bearer fg_live_wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("reports ready but degraded", async () => {
    const res = await app.request("/health/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { redis: string; postgres: string } };
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe("down");
    expect(body.checks.postgres).toBe("up");
  });
});

describe("gateway with Kafka unavailable", () => {
  let tenant: Session;
  let apiKey: { rawKey: string };
  let upstream: TestServer;

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant();
    apiKey = await createApiKey(tenant);
    upstream = await startTestServer((_, res) => res.end("served"));
    await tenant.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstream.url });
  });

  afterEach(() => upstream.close());

  // The producer is never started in this process, which is the state of a broker
  // unreachable since startup. Loss after connecting is in tests/unit/kafka-producer.test.ts.
  it("serves traffic and buffers telemetry when the broker was never reachable", async () => {
    const res = await app.request("/gateway/svc", {
      headers: { Authorization: `Bearer ${apiKey.rawKey}` },
    });
    expect(res.status).toBe(200);
    await res.text();

    const ready = await app.request("/health/ready");
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as {
      status: string;
      checks: { kafka: string };
      telemetryBuffered: number;
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.kafka).toBe("down");
    expect(body.telemetryBuffered).toBeGreaterThan(0);
  });
});

describe("metrics labels", () => {
  beforeEach(resetState);

  it("uses the route pattern, not the raw path", async () => {
    const tenant = await createTenant();
    const apiKey = await createApiKey(tenant);
    await app.request("/gateway/unique-path-a1b2c3", {
      headers: { Authorization: `Bearer ${apiKey.rawKey}` },
    });
    const metrics = await (await app.request("/metrics")).text();
    expect(metrics).not.toContain("unique-path-a1b2c3");
    expect(metrics).toContain('route="/gateway/*"');
  });
});
