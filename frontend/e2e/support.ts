import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { DATABASE_URL, GATEWAY_URL, INTERNAL_ALERT_SECRET, REDIS_URL } from "./constants";

export { GATEWAY_URL };

/** For states the API will not create, like an expired key or last week's traffic. */
export async function withDb<T>(run: (sql: postgres.Sql) => Promise<T> | PromiseLike<T>): Promise<T> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

// Text from ai-service/alerts.py, so that the UI is tested against what it really gets.
export const FOREST_MESSAGE =
  "Isolation Forest flagged abnormal traffic, driven mainly by latency (4,200 ms)";
export const guardMessage = (forest: "did not flag it" | "also flagged it") =>
  `Response size 52,428,800 bytes exceeds the range guard limit 31,457,100 bytes (a multiple of the largest value in the training data); the Isolation Forest ${forest}`;

export const PASSWORD = "correct-horse-battery";

export const uniqueEmail = (label: string) =>
  `${label}-${randomUUID().slice(0, 8)}@e2e.fluxgate.test`;

/**
 * A browser logs every 4xx/5xx fetch as a console error, including ones the UI
 * handles on purpose, so tests declare which statuses they expect. Anything else
 * logged as an error, and any uncaught exception, fails the test.
 */
export const test = base.extend<{
  expectedHttpErrors: number[];
  consoleGuard: void;
  freshThrottle: void;
}>({
  expectedHttpErrors: [[], { option: true }],
  freshThrottle: [
    async ({}, use) => {
      execFileSync(process.execPath, [path.join(__dirname, "reset-throttle.mjs")], {
        env: { ...process.env, REDIS_URL },
      });
      await use();
    },
    { auto: true },
  ],
  consoleGuard: [
    async ({ page, expectedHttpErrors }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error" && message.type() !== "warning") return;
        const text = message.text();
        const status = /status of (\d{3})/.exec(text)?.[1];
        if (status && expectedHttpErrors.includes(Number(status))) return;
        problems.push(`${message.type()}: ${text}`);
      });
      await use();
      expect(problems, "console errors and warnings").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export interface Account {
  email: string;
  password: string;
}

/** Creates a workspace through the real signup endpoint. */
export async function signUp(request: APIRequestContext, label: string): Promise<Account> {
  const account = { email: uniqueEmail(label), password: PASSWORD };
  const res = await request.post(`${GATEWAY_URL}/auth/signup`, {
    data: { tenantName: `E2E ${label}`, ...account },
  });
  expect(res.status(), await res.text()).toBe(201);
  return account;
}

/** Signs in through the page's context, so the session cookie lands in its browser. */
export async function logIn(page: Page, account: Account) {
  const res = await page.request.post(`${GATEWAY_URL}/auth/login`, { data: account });
  expect(res.status(), await res.text()).toBe(200);
}

export async function tenantIdOf(page: Page): Promise<string> {
  const res = await page.request.get(`${GATEWAY_URL}/auth/me`);
  return (await res.json()).user.tenantId;
}

export interface LocalServer {
  url: string;
  requests: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }[];
  close: () => Promise<void>;
}

/** A real HTTP server the gateway proxies to, or delivers webhooks to. */
export async function startServer(
  handler: (path: string) => { status: number; delayMs?: number; body?: string },
): Promise<LocalServer> {
  const requests: LocalServer["requests"] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "/";
      requests.push({
        method: req.method ?? "GET",
        path,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      const { status, delayMs = 0, body = "{}" } = handler(path);
      setTimeout(() => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      }, delayMs);
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
}

export async function viaGateway(
  request: APIRequestContext,
  key: string,
  path: string,
): Promise<number> {
  const res = await request.get(`${GATEWAY_URL}/gateway${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.status();
}

/**
 * Posts an alert exactly as ai-service does: HMAC-signed, to /internal/alerts. The
 * Python consumer is not run here (the repo's own pipeline e2e covers it), so the
 * numbers are chosen by the test, but everything from this endpoint to the page is real.
 */
export async function postAlert(
  request: APIRequestContext,
  tenantId: string,
  overrides: Record<string, unknown> = {},
) {
  const body = JSON.stringify({
    tenantId,
    alertType: "anomaly_detected",
    requestId: randomUUID(),
    detector: "forest",
    score: -0.0813,
    modelVersion: "e2e-fixture",
    topFeature: "latencyMs",
    topFeatureValue: 4200,
    attribution: { latencyMs: -3.142, responseByteSize: 0.212, requestByteSize: -0.074 },
    features: { latencyMs: 4200, responseByteSize: 1843, requestByteSize: 512 },
    message: FOREST_MESSAGE,
    detectedAt: new Date().toISOString(),
    ...overrides,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", INTERNAL_ALERT_SECRET).update(`${timestamp}.${body}`).digest("hex");
  const res = await request.post(`${GATEWAY_URL}/internal/alerts`, {
    headers: {
      "Content-Type": "application/json",
      "X-FluxGate-Signature": `t=${timestamp},v1=${digest}`,
    },
    data: body,
  });
  expect(res.status(), await res.text()).toBe(202);
}
