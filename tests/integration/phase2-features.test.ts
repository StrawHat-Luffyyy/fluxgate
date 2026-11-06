import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/db/index.js";
import { requestLogs, webhookDeliveries } from "../../src/db/schema.js";
import app from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { signPayload } from "../../src/lib/signature.js";
import {
  enqueueRequestLog,
  flushRequestLogs,
  RETENTION_DAYS,
  runRetention,
} from "../../src/telemetry/requestLogWriter.js";
import {
  createApiKey,
  createTenant,
  createViewer,
  resetState,
  startTestServer,
  type Session,
  type TestServer,
} from "./helpers.js";

const sendAlert = (tenantId: string, requestId: string, overrides: object = {}) => {
  const body = JSON.stringify({
    tenantId,
    alertType: "anomaly_detected",
    requestId,
    detector: "forest",
    score: -0.2,
    modelVersion: "v-test",
    topFeature: "latencyMs",
    topFeatureValue: 30000,
    attribution: { latencyMs: -0.5, requestByteSize: 0.01, responseByteSize: 0.02 },
    features: { latencyMs: 30000, requestByteSize: 0, responseByteSize: 10 },
    message: "Latency anomaly",
    detectedAt: new Date().toISOString(),
    ...overrides,
  });
  return app.request("/internal/alerts", {
    method: "POST",
    headers: { "X-FluxGate-Signature": signPayload(env.INTERNAL_ALERT_SECRET, body) },
    body,
  });
};

describe("per-tenant rate limit config", () => {
  let tenantA: Session;
  let tenantB: Session;
  let upstream: TestServer;
  let keyA: string;
  let keyB: string;

  const hit = async (key: string) => {
    const res = await app.request("/gateway/svc", {
      headers: { Authorization: `Bearer ${key}` },
    });
    await res.text();
    return res;
  };

  beforeEach(async () => {
    await resetState();
    tenantA = await createTenant("Tenant A");
    tenantB = await createTenant("Tenant B");
    upstream = await startTestServer((_, res) => res.end("ok"));
    for (const tenant of [tenantA, tenantB]) {
      await tenant.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstream.url });
    }
    keyA = (await createApiKey(tenantA)).rawKey;
    keyB = (await createApiKey(tenantB)).rawKey;
  });

  afterEach(() => upstream.close());

  it("applies a saved config immediately, to that tenant only", async () => {
    const saved = await tenantA.request("PUT", "/admin/rate-limit", {
      strategy: "sliding_window",
      capacity: 2,
      refillRate: 1,
      windowMs: 60_000,
    });
    expect(saved.status).toBe(200);

    expect((await hit(keyA)).headers.get("x-ratelimit-strategy")).toBe("sliding_window");
    expect((await hit(keyA)).status).toBe(200);
    const rejected = await hit(keyA);
    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers.get("retry-after"))).toBeGreaterThan(1);

    const other = await hit(keyB);
    expect(other.status).toBe(200);
    expect(other.headers.get("x-ratelimit-strategy")).toBe("token_bucket");
    expect(other.headers.get("x-ratelimit-limit")).toBe("100");
  });

  it("can switch strategy with live traffic, without a Redis type error", async () => {
    for (const strategy of ["token_bucket", "leaky_bucket", "sliding_window", "token_bucket"]) {
      await tenantA.request("PUT", "/admin/rate-limit", {
        strategy,
        capacity: 5,
        refillRate: 1,
        windowMs: 60_000,
      });
      const res = await hit(keyA);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-ratelimit-strategy")).toBe(strategy);
      expect(res.headers.get("x-ratelimit-fallback")).toBeNull();
    }
  });

  it.each([
    { strategy: "token_bucket", capacity: 5, refillRate: 0, windowMs: 60_000 },
    { strategy: "token_bucket", capacity: 5, refillRate: 1e-300, windowMs: 60_000 },
    { strategy: "token_bucket", capacity: 0, refillRate: 1, windowMs: 60_000 },
    { strategy: "nope", capacity: 5, refillRate: 1, windowMs: 60_000 },
    { strategy: "sliding_window", capacity: 5, refillRate: 1, windowMs: 10 },
  ])("rejects invalid config %o", async (config) => {
    expect((await tenantA.request("PUT", "/admin/rate-limit", config)).status).toBe(400);
  });

  it("is admin-only to change and readable by viewers", async () => {
    const viewer = await createViewer(tenantA);
    const config = { strategy: "token_bucket", capacity: 5, refillRate: 1, windowMs: 60_000 };
    expect((await viewer.request("PUT", "/admin/rate-limit", config)).status).toBe(403);
    expect((await viewer.request("GET", "/admin/rate-limit")).status).toBe(200);
  });
});

describe("analytics from real request logs", () => {
  let tenant: Session;
  let other: Session;
  let upstream: TestServer;
  let key: { id: string; rawKey: string };

  const call = async (path: string, authKey = key.rawKey) => {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${authKey}` } });
    await res.text();
    return res;
  };

  const overview = async (session: Session, range = "1h") => {
    const res = await session.request("GET", `/analytics/overview?range=${range}`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await res.json()) as any;
  };

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant("Measured");
    other = await createTenant("Other");
    key = await createApiKey(tenant);
    upstream = await startTestServer((req, res) => {
      if (req.url.startsWith("/fail")) res.statusCode = 500;
      res.end("0123456789");
    });
    await tenant.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstream.url });
  });

  afterEach(() => upstream.close());

  it("reports zeros and a full empty time series with no traffic", async () => {
    const { summary, timeSeries } = await overview(tenant);
    expect(summary.totalRequests).toBe(0);
    expect(summary.errorRate).toBe(0);
    expect(summary.p99LatencyMs).toBeNull(); // No data, which is not a latency of 0.
    expect(timeSeries.length).toBeGreaterThanOrEqual(60);
    expect(timeSeries.every((b: { requests: number }) => b.requests === 0)).toBe(true);
  });

  it("counts real traffic, errors, rate limits and bytes", async () => {
    await tenant.request("PUT", "/admin/rate-limit", {
      strategy: "sliding_window",
      capacity: 5,
      refillRate: 1,
      windowMs: 60_000,
    });
    for (let i = 0; i < 3; i++) await call("/gateway/svc/ok");
    await call("/gateway/svc/fail/x"); // Upstream 500. Prefix is /svc.
    await call("/gateway/svc/ok");
    await call("/gateway/svc/ok"); // Sixth request: rejected with 429.
    await flushRequestLogs();

    const { summary, topRoutes, topConsumers, timeSeries } = await overview(tenant);
    expect(summary.totalRequests).toBe(6);
    expect(summary.errorCount).toBe(1);
    expect(summary.errorRate).toBeCloseTo(1 / 6);
    expect(summary.rateLimitedCount).toBe(1);
    expect(summary.p50LatencyMs).not.toBeNull();
    expect(summary.p99LatencyMs).toBeGreaterThanOrEqual(summary.p50LatencyMs);

    expect(topRoutes[0]).toMatchObject({ routePrefix: "/svc", requests: 6, errors: 1 });
    expect(topConsumers[0]).toMatchObject({ apiKeyId: key.id, requests: 6, rateLimited: 1, name: "test" });

    const seriesTotal = timeSeries.reduce((sum: number, b: { requests: number }) => sum + b.requests, 0);
    expect(seriesTotal).toBe(6);

    // Telemetry from an earlier test's requests can land after its reset.
    const rows = (await db.select().from(requestLogs)).filter((r) => r.tenantId === tenant.tenantId);
    const served = rows.find((r) => r.statusCode === 200);
    expect(served?.responseBytes).toBe(10);
    expect(served?.upstreamCalled).toBe(true);
    const limited = rows.find((r) => r.statusCode === 429);
    expect(limited?.rateLimited).toBe(true);
    expect(limited?.upstreamCalled).toBe(false);
  });

  it("computes percentiles from stored latencies, ignoring requests with no upstream", async () => {
    const base = {
      tenantId: tenant.tenantId,
      apiKeyId: key.id,
      method: "GET",
      routePrefix: "/svc",
      statusCode: 200,
      requestBytes: 0,
      responseBytes: 0,
      rateLimited: false,
      upstreamCalled: true,
      createdAt: new Date(),
    };
    await db.insert(requestLogs).values(
      Array.from({ length: 100 }, (_, i) => ({
        ...base,
        requestId: crypto.randomUUID(),
        latencyMs: i + 1, // 1..100
      })),
    );
    await db.insert(requestLogs).values({
      ...base,
      requestId: crypto.randomUUID(),
      latencyMs: 0,
      statusCode: 429,
      rateLimited: true,
      upstreamCalled: false,
    });

    const { summary } = await overview(tenant);
    expect(summary.totalRequests).toBe(101);
    expect(summary.p50LatencyMs).toBeCloseTo(50.5);
    expect(summary.p95LatencyMs).toBeCloseTo(95.05);
    expect(summary.p99LatencyMs).toBeCloseTo(99.01);
  });

  it("does not leak traffic between tenants", async () => {
    await call("/gateway/svc/ok");
    await flushRequestLogs();
    await sendAlert(tenant.tenantId, crypto.randomUUID());
    const { summary, topRoutes, topConsumers, timeSeries } = await overview(other);
    expect(summary.totalRequests).toBe(0);
    expect(summary.totalAnomalies).toBe(0);
    expect(topRoutes).toEqual([]);
    expect(topConsumers).toEqual([]);
    for (const bucket of timeSeries) {
      expect(bucket).toMatchObject({ requests: 0, anomalies: 0, errors: 0 });
    }
  });

  it("does not reveal another tenant's key name through a log row that references it", async () => {
    await db.insert(requestLogs).values({
      requestId: crypto.randomUUID(),
      tenantId: other.tenantId,
      apiKeyId: key.id, // Belongs to `tenant`, not `other`.
      method: "GET",
      routePrefix: "/x",
      statusCode: 200,
      latencyMs: 1,
      requestBytes: 0,
      responseBytes: 0,
      rateLimited: false,
      upstreamCalled: true,
      createdAt: new Date(),
    });
    const { topConsumers } = await overview(other);
    expect(topConsumers[0]).toMatchObject({ name: "Unknown key", hint: "" });
  });

  it.each([
    ["1h", 60],
    ["24h", 60 * 60],
    ["7d", 6 * 60 * 60],
  ])("aligns %s buckets to a fixed width and covers the range", async (range, seconds) => {
    const { timeSeries } = await overview(tenant, range as string);
    const times = timeSeries.map((b: { time: string }) => new Date(b.time).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBe((seconds as number) * 1000);
    }
    expect(times[times.length - 1]).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - times[times.length - 1]).toBeLessThan((seconds as number) * 1000);
  });

  it("isolates an unstorable row instead of losing the whole batch", async () => {
    const good = (requestId: string) => ({
      requestId,
      tenantId: tenant.tenantId,
      apiKeyId: key.id,
      method: "GET",
      path: "/gateway/svc",
      routePrefix: "/svc",
      clientIp: "unknown",
      requestByteSize: 0,
      responseByteSize: 0,
      statusCode: 200,
      latencyMs: 1,
      rateLimited: false,
      upstreamCalled: true,
      timestamp: Date.now(),
    });
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    enqueueRequestLog(good(ids[0]));
    enqueueRequestLog({ ...good(crypto.randomUUID()), routePrefix: "/bad\u0000prefix" });
    enqueueRequestLog({ ...good(crypto.randomUUID()), requestId: "not-a-uuid" });
    enqueueRequestLog(good(ids[1]));
    enqueueRequestLog(good(ids[2]));
    await flushRequestLogs();

    const rows = (await db.select().from(requestLogs)).filter((r) => r.tenantId === tenant.tenantId);
    expect(rows.map((r) => r.requestId).sort()).toEqual([...ids].sort());
  });

  it("survives hostile request values end to end", async () => {
    const res = await app.request("/gateway/%00svc", {
      headers: {
        Authorization: `Bearer ${key.rawKey}`,
        "Content-Length": "18000000000000000000",
      },
    });
    await res.text();
    await call("/gateway/svc/ok");
    await flushRequestLogs();
    const { summary } = await overview(tenant);
    expect(summary.totalRequests).toBe(2);
  });

  it("records a chunked upload's real size, with no Content-Length", async () => {
    const res = await app.request("/gateway/svc/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.rawKey}` },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("a".repeat(1000)));
          controller.enqueue(new TextEncoder().encode("b".repeat(234)));
          controller.close();
        },
      }),
      // @ts-expect-error Node's fetch types omit duplex
      duplex: "half",
    });
    await res.text();
    await flushRequestLogs();
    const rows = (await db.select().from(requestLogs)).filter((r) => r.tenantId === tenant.tenantId);
    expect(rows[0].requestBytes).toBe(1234);
  });

  it("counts an unreachable upstream as an upstream request, so latency sees it", async () => {
    await tenant.request("POST", "/admin/routes", {
      pathPrefix: "/down",
      targetUrl: "http://127.0.0.1:59999",
    });
    expect((await call("/gateway/down")).status).toBe(502);
    await flushRequestLogs();
    const rows = (await db.select().from(requestLogs)).filter((r) => r.tenantId === tenant.tenantId);
    expect(rows[0]).toMatchObject({ statusCode: 502, upstreamCalled: true });
  });

  it("excludes rows outside the requested range", async () => {
    await db.insert(requestLogs).values({
      requestId: crypto.randomUUID(),
      tenantId: tenant.tenantId,
      apiKeyId: key.id,
      method: "GET",
      routePrefix: "/old",
      statusCode: 200,
      latencyMs: 5,
      requestBytes: 0,
      responseBytes: 0,
      rateLimited: false,
      upstreamCalled: true,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    expect((await overview(tenant, "1h")).summary.totalRequests).toBe(0);
    expect((await overview(tenant, "24h")).summary.totalRequests).toBe(1);
  });

  it("rejects an unknown range", async () => {
    expect((await tenant.request("GET", "/analytics/overview?range=1y")).status).toBe(400);
  });

  it("deletes rows past the retention window", async () => {
    const row = {
      tenantId: tenant.tenantId,
      apiKeyId: key.id,
      method: "GET",
      routePrefix: "/svc",
      statusCode: 200,
      latencyMs: 5,
      requestBytes: 0,
      responseBytes: 0,
      rateLimited: false,
      upstreamCalled: true,
    };
    const dayMs = 24 * 60 * 60 * 1000;
    await db.insert(requestLogs).values([
      { ...row, requestId: crypto.randomUUID(), createdAt: new Date(Date.now() - (RETENTION_DAYS + 1) * dayMs) },
      { ...row, requestId: crypto.randomUUID(), createdAt: new Date(Date.now() - (RETENTION_DAYS - 1) * dayMs) },
    ]);
    await runRetention();
    expect(await db.select().from(requestLogs)).toHaveLength(1);
  });
});

describe("anomalies", () => {
  let tenant: Session;
  let other: Session;

  const list = async (session: Session, query = "") => {
    const res = await session.request("GET", `/anomalies${query}`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((await res.json()) as any).anomalies as any[];
  };

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant("Watched");
    other = await createTenant("Other");
  });

  it("persists an alert with its score and SHAP attribution", async () => {
    const requestId = crypto.randomUUID();
    expect((await sendAlert(tenant.tenantId, requestId)).status).toBe(202);

    const [anomaly] = await list(tenant);
    expect(anomaly).toMatchObject({
      requestId,
      status: "open",
      detector: "forest",
      score: -0.2,
      modelVersion: "v-test",
      topFeature: "latencyMs",
      topFeatureValue: 30000,
    });
    expect(anomaly.attribution.latencyMs).toBe(-0.5);
  });

  it("is idempotent: a redelivered alert creates no anomaly and no webhook", async () => {
    await tenant.request("POST", "/webhooks", { url: "https://example.com/hook" });
    const requestId = crypto.randomUUID();

    const first = await sendAlert(tenant.tenantId, requestId);
    const second = await sendAlert(tenant.tenantId, requestId);

    expect(((await first.json()) as { created: boolean }).created).toBe(true);
    expect(second.status).toBe(202);
    expect(((await second.json()) as { created: boolean }).created).toBe(false);
    expect(await list(tenant)).toHaveLength(1);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
  });

  it("treats the same request id in two tenants as two anomalies", async () => {
    const requestId = crypto.randomUUID();
    await sendAlert(tenant.tenantId, requestId);
    await sendAlert(other.tenantId, requestId);
    expect(await list(tenant)).toHaveLength(1);
    expect(await list(other)).toHaveLength(1);
  });

  it("returns 404 for an unknown tenant, which ai-service treats as permanent", async () => {
    const res = await sendAlert(crypto.randomUUID(), crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("TENANT_NOT_FOUND");
  });

  it("hides anomalies from other tenants and refuses to update them", async () => {
    await sendAlert(tenant.tenantId, crypto.randomUUID());
    const [anomaly] = await list(tenant);

    expect(await list(other)).toEqual([]);
    const update = await other.request("PATCH", `/anomalies/${anomaly.id}`, { status: "resolved" });
    expect(update.status).toBe(404);
    expect((await list(tenant))[0].status).toBe("open");
  });

  it("moves through statuses, filters on them, and is admin-only to change", async () => {
    await sendAlert(tenant.tenantId, crypto.randomUUID());
    const [anomaly] = await list(tenant);
    const viewer = await createViewer(tenant);

    expect((await viewer.request("PATCH", `/anomalies/${anomaly.id}`, { status: "resolved" })).status).toBe(403);
    expect((await tenant.request("PATCH", `/anomalies/${anomaly.id}`, { status: "resolved" })).status).toBe(200);
    expect(await list(tenant, "?status=open")).toEqual([]);
    expect(await list(viewer, "?status=resolved")).toHaveLength(1);
  });

  it("pages through anomalies sharing a timestamp without skipping any", async () => {
    const detectedAt = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await sendAlert(tenant.tenantId, crypto.randomUUID(), { detectedAt });
    }
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const res: Response = await tenant.request("GET", `/anomalies?limit=2${query}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = (await res.json()) as any;
      body.anomalies.forEach((a: { id: string }) => seen.add(a.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(5);
  });

  it("feeds the analytics anomaly counts", async () => {
    await sendAlert(tenant.tenantId, crypto.randomUUID());
    const res = await tenant.request("GET", "/analytics/overview?range=1h");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.summary.totalAnomalies).toBe(1);
    expect(body.summary.openAnomalies).toBe(1);
    expect(body.timeSeries.reduce((sum: number, b: { anomalies: number }) => sum + b.anomalies, 0)).toBe(1);
  });
});
