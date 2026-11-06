import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import app from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { webhookDeliveries } from "../../src/db/schema.js";
import {
  createApiKey,
  createTenant,
  createViewer,
  PASSWORD,
  resetState,
  startTestServer,
  type Session,
} from "./helpers.js";

const WEBHOOK_URL = "https://example.com/hook";

describe("tenant isolation", () => {
  let tenantA: Session;
  let tenantB: Session;

  beforeEach(async () => {
    await resetState();
    tenantA = await createTenant("Tenant A");
    tenantB = await createTenant("Tenant B");
  });

  describe("routes", () => {
    const createRoute = async () => {
      const res = await tenantA.request("POST", "/admin/routes", {
        pathPrefix: "/orders",
        targetUrl: "https://example.com",
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { route: { id: string } }).route.id;
    };

    it("does not list another tenant's routes", async () => {
      await createRoute();
      const res = await tenantB.request("GET", "/admin/routes");
      const { routes } = (await res.json()) as { routes: unknown[] };
      expect(routes).toEqual([]);
    });

    it("returns 404 when updating another tenant's route", async () => {
      const id = await createRoute();
      const res = await tenantB.request("PATCH", `/admin/routes/${id}`, {
        targetUrl: "https://attacker.example.com",
      });
      expect(res.status).toBe(404);

      const own = await tenantA.request("GET", "/admin/routes");
      const { routes } = (await own.json()) as { routes: { targetUrl: string }[] };
      expect(routes[0].targetUrl).toBe("https://example.com");
    });

    it("returns 404 when deleting another tenant's route", async () => {
      const id = await createRoute();
      expect((await tenantB.request("DELETE", `/admin/routes/${id}`)).status).toBe(404);
      const own = await tenantA.request("GET", "/admin/routes");
      expect(((await own.json()) as { routes: unknown[] }).routes).toHaveLength(1);
    });

    it("lets two tenants use the same path prefix for different upstreams", async () => {
      const upstreamA = await startTestServer((_, res) => res.end("from A"));
      const upstreamB = await startTestServer((_, res) => res.end("from B"));
      try {
        await tenantA.request("POST", "/admin/routes", { pathPrefix: "/shared", targetUrl: upstreamA.url });
        await tenantB.request("POST", "/admin/routes", { pathPrefix: "/shared", targetUrl: upstreamB.url });
        const keyA = await createApiKey(tenantA);
        const keyB = await createApiKey(tenantB);

        const viaA = await app.request("/gateway/shared", { headers: { Authorization: `Bearer ${keyA.rawKey}` } });
        const viaB = await app.request("/gateway/shared", { headers: { Authorization: `Bearer ${keyB.rawKey}` } });
        expect(await viaA.text()).toBe("from A");
        expect(await viaB.text()).toBe("from B");
      } finally {
        await upstreamA.close();
        await upstreamB.close();
      }
    });

    it("does not route a tenant's API key to another tenant's upstream", async () => {
      await createRoute();
      const keyB = await createApiKey(tenantB);
      const res = await app.request("/gateway/orders", {
        headers: { Authorization: `Bearer ${keyB.rawKey}` },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("API keys", () => {
    it("does not list another tenant's keys", async () => {
      await createApiKey(tenantA);
      const res = await tenantB.request("GET", "/keys");
      expect(((await res.json()) as { keys: unknown[] }).keys).toEqual([]);
    });

    it("returns 404 when revoking another tenant's key, and the key keeps working", async () => {
      const key = await createApiKey(tenantA);
      expect((await tenantB.request("DELETE", `/keys/${key.id}`)).status).toBe(404);

      const res = await app.request("/gateway/none", {
        headers: { Authorization: `Bearer ${key.rawKey}` },
      });
      expect(res.status).toBe(404); // Authenticated: only the route is missing.
      expect(((await res.json()) as { message: string }).message).toContain("No upstream route");
    });

    it("returns 404 when rotating another tenant's key", async () => {
      const key = await createApiKey(tenantA);
      expect((await tenantB.request("POST", `/keys/${key.id}/rotate`)).status).toBe(404);
    });

    it("never returns the key hash", async () => {
      await createApiKey(tenantA);
      const res = await tenantA.request("GET", "/keys");
      expect(await res.text()).not.toMatch(/keyHash|key_hash/);
    });
  });

  describe("team", () => {
    it("does not list another tenant's members", async () => {
      const res = await tenantB.request("GET", "/team");
      const { members } = (await res.json()) as { members: { email: string }[] };
      expect(members.map((m) => m.email)).toEqual([tenantB.email]);
    });

    it("returns 404 when changing another tenant's member", async () => {
      const viewer = await createViewer(tenantA);
      const res = await tenantB.request("PATCH", `/team/${viewer.userId}`, { role: "admin" });
      expect(res.status).toBe(404);
    });

    it("returns 404 when removing another tenant's member", async () => {
      const viewer = await createViewer(tenantA);
      expect((await tenantB.request("DELETE", `/team/${viewer.userId}`)).status).toBe(404);
    });
  });

  describe("webhooks", () => {
    const createEndpoint = async () => {
      const res = await tenantA.request("POST", "/webhooks", { url: WEBHOOK_URL });
      expect(res.status).toBe(201);
      return ((await res.json()) as { endpoint: { id: string } }).endpoint.id;
    };

    it("does not list another tenant's endpoints", async () => {
      await createEndpoint();
      const res = await tenantB.request("GET", "/webhooks");
      expect(((await res.json()) as { endpoints: unknown[] }).endpoints).toEqual([]);
    });

    it("returns 404 for update, delete and test on another tenant's endpoint", async () => {
      const id = await createEndpoint();
      expect((await tenantB.request("PATCH", `/webhooks/${id}`, { enabled: false })).status).toBe(404);
      expect((await tenantB.request("DELETE", `/webhooks/${id}`)).status).toBe(404);
      expect((await tenantB.request("POST", `/webhooks/${id}/test`)).status).toBe(404);
    });

    it("hides another tenant's deliveries and refuses to retry them", async () => {
      const endpointId = await createEndpoint();
      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          tenantId: tenantA.tenantId,
          endpointId,
          eventType: "anomaly.detected",
          payload: {},
          status: "dead",
        })
        .returning();

      const list = await tenantB.request("GET", "/webhooks/deliveries");
      expect(((await list.json()) as { deliveries: unknown[] }).deliveries).toEqual([]);

      const retry = await tenantB.request("POST", `/webhooks/deliveries/${delivery.id}/retry`);
      expect(retry.status).toBe(404);

      const [row] = await db
        .select({ status: webhookDeliveries.status })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, delivery.id));
      expect(row.status).toBe("dead");
    });

    it("never returns a signing secret after creation", async () => {
      await createEndpoint();
      const res = await tenantA.request("GET", "/webhooks");
      expect(await res.text()).not.toMatch(/secret/i);
    });
  });

  it("returns 404 rather than 500 for a malformed id", async () => {
    expect((await tenantA.request("DELETE", "/keys/not-a-uuid")).status).toBe(404);
    expect((await tenantA.request("DELETE", "/admin/routes/not-a-uuid")).status).toBe(404);
  });
});

describe("account creation and sessions", () => {
  beforeEach(resetState);

  it("cannot join an existing tenant or choose a role through signup", async () => {
    const victim = await createTenant("Victim");
    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantName: "Attacker",
        email: "attacker@example.com",
        password: PASSWORD,
        tenantId: victim.tenantId,
        role: "viewer",
      }),
    });
    expect(res.status).toBe(201);
    const { user } = (await res.json()) as { user: { tenantId: string; role: string } };
    expect(user.tenantId).not.toBe(victim.tenantId);
    expect(user.role).toBe("admin"); // Admin of the new tenant, as the only member.
  });

  it("has removed the unauthenticated register and tenant endpoints", async () => {
    const victim = await createTenant("Victim");
    const register = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attacker@example.com",
        password: PASSWORD,
        tenantId: victim.tenantId,
        role: "admin",
      }),
    });
    expect(register.status).toBe(404);

    const tenants = await app.request("/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", plan: "free" }),
    });
    expect(tenants.status).toBe(404);
  });

  it("rejects POST /keys without a session even when the body names a tenant", async () => {
    const victim = await createTenant("Victim");
    const res = await app.request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: victim.tenantId }),
    });
    expect(res.status).toBe(401);
  });

  it("ignores a tenantId in the POST /keys body when a session exists", async () => {
    const victim = await createTenant("Victim");
    const attacker = await createTenant("Attacker");
    const res = await attacker.request("POST", "/keys", { name: "x", tenantId: victim.tenantId });
    expect(res.status).toBe(201);

    const victimKeys = await victim.request("GET", "/keys");
    expect(((await victimKeys.json()) as { keys: unknown[] }).keys).toEqual([]);
    const attackerKeys = await attacker.request("GET", "/keys");
    expect(((await attackerKeys.json()) as { keys: unknown[] }).keys).toHaveLength(1);
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    const tenant = await createTenant();
    const attempt = (email: string) =>
      app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password-here" }),
      });
    const wrongPassword = await attempt(tenant.email);
    const unknownEmail = await attempt("nobody@example.com");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const shape = async (res: Response) => {
      const { error, message } = (await res.json()) as { error: string; message: string };
      return { error, message };
    };
    expect(await shape(wrongPassword)).toEqual(await shape(unknownEmail));
  });

  it("applies a role change on the next request, without a new session", async () => {
    const admin = await createTenant();
    const viewer = await createViewer(admin);
    expect((await viewer.request("POST", "/keys", { name: "x" })).status).toBe(403);
    await admin.request("PATCH", `/team/${viewer.userId}`, { role: "admin" });
    expect((await viewer.request("POST", "/keys", { name: "x" })).status).toBe(201);
  });

  it("rejects a removed user's session immediately", async () => {
    const admin = await createTenant();
    const viewer = await createViewer(admin);
    await admin.request("DELETE", `/team/${viewer.userId}`);
    expect((await viewer.request("GET", "/keys")).status).toBe(401);
  });
});

describe("role hierarchy", () => {
  let admin: Session;
  let viewer: Session;

  beforeEach(async () => {
    await resetState();
    admin = await createTenant();
    viewer = await createViewer(admin);
  });

  const mutations: [string, string, unknown][] = [
    ["POST", "/keys", { name: "x" }],
    ["POST", "/admin/routes", { pathPrefix: "/x", targetUrl: "https://example.com" }],
    ["POST", "/webhooks", { url: WEBHOOK_URL }],
    ["POST", "/team", { email: "new@example.com", password: PASSWORD, role: "viewer" }],
  ];

  it.each(mutations)("denies a viewer %s %s", async (method, path, body) => {
    expect((await viewer.request(method, path, body)).status).toBe(403);
  });

  it.each(mutations)("allows an admin %s %s", async (method, path, body) => {
    expect((await admin.request(method, path, body)).status).toBe(201);
  });

  const reads = ["/keys", "/admin/routes", "/webhooks", "/webhooks/deliveries", "/team"];

  it.each(reads)("allows both roles to GET %s", async (path) => {
    expect((await viewer.request("GET", path)).status).toBe(200);
    expect((await admin.request("GET", path)).status).toBe(200);
  });

  it("refuses to demote or remove the last admin", async () => {
    const demote = await admin.request("PATCH", `/team/${admin.userId}`, { role: "viewer" });
    expect(demote.status).toBe(409);
    expect((await admin.request("DELETE", `/team/${admin.userId}`)).status).toBe(409);
  });

  it("allows demoting an admin while another admin remains", async () => {
    await admin.request("PATCH", `/team/${viewer.userId}`, { role: "admin" });
    const demote = await admin.request("PATCH", `/team/${admin.userId}`, { role: "viewer" });
    expect(demote.status).toBe(200);
  });
});
