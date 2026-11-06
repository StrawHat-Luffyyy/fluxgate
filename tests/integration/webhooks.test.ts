import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import app from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { webhookDeliveries } from "../../src/db/schema.js";
import { signPayload, verifySignature } from "../../src/lib/signature.js";
import { workerConnection } from "../../src/queue/connection.js";
import { closeWebhookQueue, getWebhookQueue, WEBHOOK_QUEUE } from "../../src/queue/webhookQueue.js";
import { processDelivery, sweepPendingDeliveries } from "../../src/queue/webhookWorker.js";
import { env } from "../../src/config/env.js";
import { createTenant, resetState, startTestServer, type Session, type TestServer } from "./helpers.js";

const alertBody = (tenantId: string, requestId = crypto.randomUUID()) =>
  JSON.stringify({
    tenantId,
    alertType: "anomaly_detected",
    requestId,
    score: -0.12,
    modelVersion: "test",
    topFeature: "latencyMs",
    topFeatureValue: 30000,
    attribution: { latencyMs: -0.4, requestByteSize: 0.01, responseByteSize: 0.02 },
    features: { latencyMs: 30000, requestByteSize: 0, responseByteSize: 100 },
    message: "test",
    detectedAt: new Date().toISOString(),
  });

const postAlert = (body: string, signature?: string) =>
  app.request("/internal/alerts", {
    method: "POST",
    headers: signature ? { "X-FluxGate-Signature": signature } : {},
    body,
  });

const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
};

describe("POST /internal/alerts authentication", () => {
  let tenant: Session;
  beforeEach(async () => {
    await resetState();
    tenant = await createTenant();
  });

  it("rejects a missing signature", async () => {
    expect((await postAlert(alertBody(tenant.tenantId))).status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = alertBody(tenant.tenantId);
    expect((await postAlert(body, signPayload("wrong-secret-wrong-secret", body))).status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const body = alertBody(tenant.tenantId);
    const signature = signPayload(env.INTERNAL_ALERT_SECRET, body);
    expect((await postAlert(body.replace("latencyMs", "latencyMx"), signature)).status).toBe(401);
  });

  it("rejects a replay outside the tolerance window", async () => {
    const body = alertBody(tenant.tenantId);
    const stale = Math.floor(Date.now() / 1000) - 600;
    expect((await postAlert(body, signPayload(env.INTERNAL_ALERT_SECRET, body, stale))).status).toBe(401);
  });

  it("rejects a correctly signed but invalid payload", async () => {
    const body = JSON.stringify({ tenantId: "nope" });
    expect((await postAlert(body, signPayload(env.INTERNAL_ALERT_SECRET, body))).status).toBe(400);
  });

  it("accepts a correctly signed alert", async () => {
    const body = alertBody(tenant.tenantId);
    expect((await postAlert(body, signPayload(env.INTERNAL_ALERT_SECRET, body))).status).toBe(202);
  });
});

describe("webhook delivery", () => {
  let tenant: Session;
  let receiver: TestServer;
  let worker: Worker;
  let respondWith: () => number;

  const createEndpoint = async () => {
    const res = await tenant.request("POST", "/webhooks", { url: `${receiver.url}/hook` });
    expect(res.status).toBe(201);
    return (await res.json()) as { endpoint: { id: string }; secret: string };
  };

  const onlyDelivery = async () => {
    const rows = await db.select().from(webhookDeliveries);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  const sendAlert = async () => {
    const body = alertBody(tenant.tenantId);
    const res = await postAlert(body, signPayload(env.INTERNAL_ALERT_SECRET, body));
    expect(res.status).toBe(202);
  };

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant();
    respondWith = () => 200;
    receiver = await startTestServer((_, res) => {
      res.statusCode = respondWith();
      res.end();
    });
    worker = new Worker(WEBHOOK_QUEUE, processDelivery, {
      connection: workerConnection(),
      concurrency: 5,
    });
    await worker.waitUntilReady();
  });

  afterEach(async () => {
    await worker.close();
    await receiver.close();
  });

  afterAll(closeWebhookQueue);

  it("delivers a signed payload that verifies with the endpoint's secret", async () => {
    const { secret } = await createEndpoint();
    await sendAlert();
    await waitFor(async () => (await onlyDelivery()).status === "delivered");

    const [request] = receiver.requests;
    expect(request.url).toBe("/hook");
    expect(request.headers["x-fluxgate-event"]).toBe("anomaly.detected");
    expect(
      verifySignature(request.headers["x-fluxgate-signature"] as string, secret, request.body),
    ).toBe(true);
    expect(verifySignature(request.headers["x-fluxgate-signature"] as string, "other", request.body)).toBe(false);

    const parsed = JSON.parse(request.body) as { type: string; data: { topFeature: string } };
    expect(parsed.type).toBe("anomaly.detected");
    expect(parsed.data.topFeature).toBe("latencyMs");
  });

  it("stores the secret encrypted, not in plaintext", async () => {
    const { secret } = await createEndpoint();
    const rows = await db.query.webhookEndpoints.findMany();
    expect(rows[0].encryptedSecret).not.toContain(secret);
  });

  it("retries transient failures until the receiver recovers", async () => {
    await createEndpoint();
    let calls = 0;
    respondWith = () => (++calls === 1 ? 503 : 200);
    await sendAlert();
    await waitFor(async () => (await onlyDelivery()).status === "delivered");

    const delivery = await onlyDelivery();
    expect(delivery.attempts).toBe(2);
    expect(delivery.lastStatusCode).toBe(200);
    expect(receiver.requests).toHaveLength(2);
  });

  it("moves to dead after the configured number of attempts", async () => {
    await createEndpoint();
    respondWith = () => 500;
    await sendAlert();
    await waitFor(async () => (await onlyDelivery()).status === "dead");

    const delivery = await onlyDelivery();
    expect(delivery.attempts).toBe(env.WEBHOOK_MAX_ATTEMPTS);
    expect(delivery.lastStatusCode).toBe(500);
    expect(receiver.requests).toHaveLength(env.WEBHOOK_MAX_ATTEMPTS);
  });

  it("does not retry a permanent 4xx rejection", async () => {
    await createEndpoint();
    respondWith = () => 410;
    await sendAlert();
    await waitFor(async () => (await onlyDelivery()).status === "dead");
    expect(receiver.requests).toHaveLength(1);
  });

  it("retries a 429", async () => {
    await createEndpoint();
    let calls = 0;
    respondWith = () => (++calls === 1 ? 429 : 200);
    await sendAlert();
    await waitFor(async () => (await onlyDelivery()).status === "delivered");
    expect(receiver.requests).toHaveLength(2);
  });

  it("can manually retry a dead delivery", async () => {
    await createEndpoint();
    respondWith = () => 410;
    await sendAlert();
    await waitFor(async () => (await onlyDelivery()).status === "dead");

    respondWith = () => 200;
    const { id } = await onlyDelivery();
    expect((await tenant.request("POST", `/webhooks/deliveries/${id}/retry`)).status).toBe(202);
    await waitFor(async () => (await onlyDelivery()).status === "delivered");
  });

  it("skips disabled endpoints", async () => {
    const { endpoint } = await createEndpoint();
    await tenant.request("PATCH", `/webhooks/${endpoint.id}`, { enabled: false });
    await sendAlert();
    expect(await db.select().from(webhookDeliveries)).toEqual([]);
  });

  it("fans out one delivery per enabled endpoint", async () => {
    await createEndpoint();
    await createEndpoint();
    await sendAlert();
    await waitFor(async () => {
      const rows = await db.select().from(webhookDeliveries);
      return rows.length === 2 && rows.every((row) => row.status === "delivered");
    });
  });

  it("recovers a delivery that was never enqueued, through the sweeper", async () => {
    const { endpoint } = await createEndpoint();
    // A committed row with no job: what a Redis outage during dispatch leaves.
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        tenantId: tenant.tenantId,
        endpointId: endpoint.id,
        eventType: "anomaly.detected",
        payload: {},
      })
      .returning();
    expect(await getWebhookQueue().getJob(row.id)).toBeUndefined();

    expect(await sweepPendingDeliveries(0)).toBe(1);
    await waitFor(async () => (await onlyDelivery()).status === "delivered");
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.id, row.id));
  });

  it("sends a test event on demand", async () => {
    const { endpoint } = await createEndpoint();
    expect((await tenant.request("POST", `/webhooks/${endpoint.id}/test`)).status).toBe(202);
    await waitFor(async () => (await onlyDelivery()).status === "delivered");
    expect(receiver.requests[0].headers["x-fluxgate-event"]).toBe("webhook.test");
  });
});
