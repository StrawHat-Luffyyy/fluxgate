import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SSRF guard switched on, with a real server listening on loopback that must
// never be reached.
vi.hoisted(() => {
  process.env.ALLOW_PRIVATE_TARGETS = "false";
});

import { Worker } from "bullmq";
import app from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { gatewayRoutes, webhookDeliveries, webhookEndpoints } from "../../src/db/schema.js";
import { encryptSecret } from "../../src/lib/secretBox.js";
import { workerConnection } from "../../src/queue/connection.js";
import { closeWebhookQueue, enqueueDelivery, WEBHOOK_QUEUE } from "../../src/queue/webhookQueue.js";
import { processDelivery } from "../../src/queue/webhookWorker.js";
import { createApiKey, createTenant, resetState, startTestServer, type Session, type TestServer } from "./helpers.js";

describe("SSRF protection enforced end to end", () => {
  let tenant: Session;
  let internal: TestServer;

  beforeEach(async () => {
    await resetState();
    tenant = await createTenant();
    internal = await startTestServer((_, res) => res.end("internal secret"));
  });

  afterEach(() => internal.close());

  it.each(["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data"])(
    "refuses to save a route or webhook pointing at %s",
    async (url) => {
      const route = await tenant.request("POST", "/admin/routes", { pathPrefix: "/x", targetUrl: url });
      expect(route.status).toBe(400);
      expect(((await route.json()) as { error: string }).error).toBe("UNSAFE_TARGET_URL");

      expect((await tenant.request("POST", "/webhooks", { url })).status).toBe(400);
    },
  );

  it.each(["literal IP", "hostname"])(
    "does not proxy to a private %s, even if it is already in the database",
    async (kind) => {
      const port = new URL(internal.url).port;
      const host = kind === "hostname" ? "localhost" : "127.0.0.1";
      // Models a record saved before DNS changed, i.e. a rebinding attack.
      await db.insert(gatewayRoutes).values({
        tenantId: tenant.tenantId,
        pathPrefix: "/rebound",
        targetUrl: `http://${host}:${port}`,
      });
      const key = await createApiKey(tenant);

      const res = await app.request("/gateway/rebound", {
        headers: { Authorization: `Bearer ${key.rawKey}` },
      });
      expect(res.status).toBe(502);
      expect(((await res.json()) as { message: string }).message).toBe("Upstream target is not allowed");
      expect(internal.requests).toEqual([]);
    },
  );

  it("marks a webhook delivery to a private address dead, without retrying", async () => {
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        tenantId: tenant.tenantId,
        url: `${internal.url}/hook`,
        encryptedSecret: encryptSecret("whsec_test"),
      })
      .returning();
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({ tenantId: tenant.tenantId, endpointId: endpoint.id, eventType: "x", payload: {} })
      .returning();

    const worker = new Worker(WEBHOOK_QUEUE, processDelivery, { connection: workerConnection() });
    try {
      await enqueueDelivery(delivery.id);
      const deadline = Date.now() + 8_000;
      let row = delivery;
      while (row.status !== "dead" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        [row] = await db.select().from(webhookDeliveries);
      }
      expect(row.status).toBe("dead");
      expect(row.attempts).toBe(1);
      expect(row.lastError).toContain("private address");
      expect(internal.requests).toEqual([]);
    } finally {
      await worker.close();
      await closeWebhookQueue();
    }
  });
});
