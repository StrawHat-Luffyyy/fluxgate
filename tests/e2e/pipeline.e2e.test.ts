import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySignature } from "../../src/lib/signature.js";
import {
  apiClient,
  provisionTenant,
  startConsumer,
  startGateway,
  waitFor,
  type RunningProcess,
} from "./support.js";

// No mocks: a real gateway process, real Redis, Postgres and Kafka, the real Python
// consumer with the shipped model, and real HTTP servers as upstream and receiver.

const GATEWAY_PORT = 3101;
const BASE_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const RUN_ID = crypto.randomUUID().slice(0, 8);
const TOPIC = `e2e.traffic.${RUN_ID}`;
const DLQ_TOPIC = `e2e.dlq.${RUN_ID}`;

// Far above the model's range guard for response size, without any waiting.
const OUTLIER_BYTES = 3 * 1024 * 1024;

interface ReceivedWebhook {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe("gateway to Kafka to consumer to alert to webhook", () => {
  let gateway: RunningProcess;
  let consumer: RunningProcess;
  let upstream: Server;
  let receiver: Server;
  let upstreamUrl: string;
  let receiverUrl: string;
  const webhooks: ReceivedWebhook[] = [];
  let hugeTraceparent: string | undefined;

  beforeAll(async () => {
    // A realistic delay: localhost's 1-2 ms is outside the model's training range, and
    // it is the response size this test is about.
    upstream = createServer((req, res) => {
      if (req.url?.startsWith("/huge")) hugeTraceparent = req.headers.traceparent as string;
      const body = Buffer.alloc(req.url?.startsWith("/huge") ? OUTLIER_BYTES : 3000, "x");
      setTimeout(() => res.end(body), 80);
    });
    upstreamUrl = await listen(upstream);

    receiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        webhooks.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
        res.end();
      });
    });
    receiverUrl = await listen(receiver);

    gateway = startGateway(GATEWAY_PORT, { KAFKA_TOPIC: TOPIC });
    await waitFor("gateway Kafka connection", async () => {
      const res = await fetch(`${BASE_URL}/health/ready`);
      const body = (await res.json()) as { checks: { kafka: string } };
      return body.checks.kafka === "up";
    });

    consumer = startConsumer({
      KAFKA_TOPIC: TOPIC,
      KAFKA_DLQ_TOPIC: DLQ_TOPIC,
      KAFKA_GROUP_ID: `e2e-${RUN_ID}`,
      ALERT_ENDPOINT: `${BASE_URL}/internal/alerts`,
      HEALTH_PORT: "18091",
    });
    await waitFor("consumer health", async () => {
      const res = await fetch("http://127.0.0.1:18091/health");
      return res.status === 200;
    });
  });

  afterAll(async () => {
    await consumer?.stop();
    await gateway?.stop();
    upstream?.closeAllConnections();
    upstream?.close();
    receiver?.closeAllConnections();
    receiver?.close();
  });

  it("detects an outlier request and delivers a signed webhook, once", async () => {
    const { api, apiKey } = await provisionTenant(BASE_URL);
    await api.request("POST", "/admin/routes", { pathPrefix: "/svc", targetUrl: upstreamUrl });
    const endpoint = await api.request("POST", "/webhooks", { url: `${receiverUrl}/hook` });
    expect(endpoint.status).toBe(201);
    const { secret } = (await endpoint.json()) as { secret: string };

    const call = async (path: string) => {
      const res = await fetch(`${BASE_URL}/gateway/svc${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      await res.arrayBuffer();
      return res;
    };

    // Ordinary traffic, which must produce no alert.
    for (let i = 0; i < 5; i++) expect((await call("/normal")).status).toBe(200);

    const outlier = await call("/huge");
    expect(outlier.status).toBe(200);
    const requestId = outlier.headers.get("x-request-id");

    const received = await waitFor("webhook delivery", async () =>
      webhooks.find((w) => w.headers["x-fluxgate-event"] === "anomaly.detected"),
    );

    // The webhook verifies with the secret shown at creation.
    expect(
      verifySignature(received.headers["x-fluxgate-signature"] as string, secret, received.body),
    ).toBe(true);

    const event = JSON.parse(received.body) as {
      type: string;
      data: { requestId: string; topFeature: string; topFeatureValue: number; detector: string };
    };
    expect(event.type).toBe("anomaly.detected");
    expect(event.data.requestId).toBe(requestId);
    expect(event.data.topFeature).toBe("responseByteSize");
    expect(event.data.topFeatureValue).toBe(OUTLIER_BYTES);
    expect(event.data.detector).toBe("range_guard");

    // Persisted with attribution, and visible to the tenant.
    const list = await api.request("GET", "/anomalies");
    const { anomalies } = (await list.json()) as {
      anomalies: { requestId: string; status: string; attribution: Record<string, number> }[];
    };
    expect(anomalies.map((a) => a.requestId)).toEqual([requestId]);
    expect(anomalies[0].status).toBe("open");
    expect(Object.keys(anomalies[0].attribution).sort()).toEqual([
      "latencyMs",
      "requestByteSize",
      "responseByteSize",
    ]);

    // The delivery log agrees.
    // The receiver records the webhook before responding, and the worker marks the row
    // delivered only after that response, so this has to wait.
    await waitFor("delivery to be marked delivered", async () => {
      const deliveries = await api.request("GET", "/webhooks/deliveries");
      const body = (await deliveries.json()) as { deliveries: { status: string }[] };
      expect(body.deliveries).toHaveLength(1);
      return body.deliveries[0].status === "delivered";
    });

    // One trace id and one request id, across the upstream, the gateway, the consumer
    // and the webhook worker: every process's logs can be joined on them.
    const traceId = outlier.headers.get("x-trace-id") as string;
    expect(hugeTraceparent?.split("-")[1]).toBe(traceId);

    const consumerRecord = consumer
      .output()
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.message === "anomaly detected" && line.requestId === requestId);
    expect(consumerRecord?.traceId).toBe(traceId);

    // Development logs are pretty-printed: a record's fields are its indented lines.
    const gatewayRecords = gateway.output().split(/\r?\n(?=\S)/);
    for (const message of ["Anomaly recorded", "Webhook delivered"]) {
      const record = gatewayRecords.find((r) => r.includes(message));
      expect(record, message).toContain(traceId);
      expect(record, message).toContain(requestId as string);
    }

    // Real analytics saw all six requests, once the batcher has written them.
    const overview = await waitFor("analytics rows", async () => {
      await new Promise((resolve) => setTimeout(resolve, 11_000)); // Past the 10s cache.
      const res = await api.request("GET", "/analytics/overview?range=1h");
      const data = (await res.json()) as {
        summary: { totalRequests: number; totalAnomalies: number };
      };
      return data.summary.totalRequests === 6 ? data : null;
    });
    expect(overview.summary.totalAnomalies).toBe(1);

    // Checked last, after the long wait above: any redelivery would have arrived by now.
    expect(webhooks.filter((w) => w.headers["x-fluxgate-event"] === "anomaly.detected")).toHaveLength(1);
  });

  it("the consumer reports what it processed", async () => {
    const res = await fetch("http://127.0.0.1:18091/health");
    const health = (await res.json()) as { processed: number; anomalies: number; dlq: number; status: string };
    expect(health.status).toBe("ok");
    expect(health.processed).toBeGreaterThanOrEqual(6);
    expect(health.anomalies).toBe(1);
    expect(health.dlq).toBe(0);
  });

  it("rejects an unsigned alert sent straight to the running gateway", async () => {
    const api = apiClient(BASE_URL);
    const res = await api.request("POST", "/internal/alerts", { tenantId: "x" });
    expect(res.status).toBe(401);
  });
});
