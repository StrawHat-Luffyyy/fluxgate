import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import app from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { redis } from "../../src/redis/client.js";

export const PASSWORD = "correct-horse-battery";

/** Empties all tables and the Redis test db, so each test starts from nothing. */
export const resetState = async () => {
  await waitForRedis();
  await db.execute(sql`truncate table tenants cascade`);
  await redis.flushdb();
};

export const waitForRedis = async () => {
  for (let i = 0; i < 50 && redis.status !== "ready"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export interface Session {
  tenantId: string;
  userId: string;
  email: string;
  cookie: string;
  request: (method: string, path: string, body?: unknown) => Promise<Response>;
}

const sessionFrom = async (email: string, password: string) => {
  const login = await app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { cookie, request };
};

let counter = 0;

/** A new tenant with its admin, signed in through the real endpoints. */
export const createTenant = async (name = "Acme"): Promise<Session> => {
  counter += 1;
  const email = `admin-${counter}-${Date.now()}@example.com`;
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantName: name, email, password: PASSWORD }),
  });
  if (signup.status !== 201) throw new Error(`Signup failed: ${signup.status}`);
  const { user } = (await signup.json()) as { user: { id: string; tenantId: string } };
  const { cookie, request } = await sessionFrom(email, PASSWORD);
  return { tenantId: user.tenantId, userId: user.id, email, cookie, request };
};

/** Adds a viewer to the admin's tenant and signs them in. */
export const createViewer = async (admin: Session): Promise<Session> => {
  counter += 1;
  const email = `viewer-${counter}-${Date.now()}@example.com`;
  const created = await admin.request("POST", "/team", {
    email,
    password: PASSWORD,
    role: "viewer",
  });
  if (created.status !== 201) throw new Error(`Add viewer failed: ${created.status}`);
  const { member } = (await created.json()) as { member: { id: string } };
  const { cookie, request } = await sessionFrom(email, PASSWORD);
  return { tenantId: admin.tenantId, userId: member.id, email, cookie, request };
};

export const createApiKey = async (admin: Session): Promise<{ id: string; rawKey: string }> => {
  const res = await admin.request("POST", "/keys", { name: "test" });
  if (res.status !== 201) throw new Error(`Create key failed: ${res.status}`);
  const body = (await res.json()) as { key: { id: string }; apiKey: string };
  return { id: body.key.id, rawKey: body.apiKey };
};

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

export interface TestServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

/** A real HTTP server standing in for an upstream or a webhook receiver. */
export const startTestServer = async (
  handler: (req: RecordedRequest, res: ServerResponse) => void,
): Promise<TestServer> => {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const recorded = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
