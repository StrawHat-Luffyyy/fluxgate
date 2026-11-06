import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { closeDb, db } from "../db/index.js";
import {
  apiKeys,
  gatewayRoutes,
  rateLimitConfigs,
  requestLogs,
  tenants,
  users,
  webhookEndpoints,
} from "../db/schema.js";
import { encryptSecret } from "../lib/secretBox.js";
import { hashPassword } from "../services/auth.service.js";
import { hashKey } from "../utils/crypto.js";
import {
  DEMO_ADMIN_EMAIL,
  DEMO_API_KEY,
  DEMO_API_KEY_ID,
  DEMO_PASSWORD,
  DEMO_ROUTE_PREFIXES,
  DEMO_TENANT_ID,
  DEMO_VIEWER_EMAIL,
  DEMO_WEBHOOK_SECRET,
} from "./constants.js";
import { assertLocalDatabase } from "./guard.js";

// Runs as the compose `seed` service, and `pnpm demo:reset` starts over. Not meant for
// the host: routes and encrypted secrets are only valid on the compose network and
// with its keys. The request history below is synthetic, so that the charts have a shape
// from the first page load. Anomalies and webhook deliveries are deliberately not
// seeded: every one the demo shows came through the real pipeline from demo traffic.

const HISTORY_DAYS = 7;
const BUCKET_MS = 5 * 60 * 1000;
const BATCH_SIZE = 1000;
// About the volume of the demo traffic, so that the history and live data share a scale.
const MAX_REQUESTS_PER_BUCKET = 100;

const upstreamUrl = process.env.DEMO_UPSTREAM_URL ?? "http://localhost:4000";

/** Seeded, so that every run produces the same history. */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const historyRows = () => {
  const random = seededRandom(42);
  const logNormal = (median: number, sigma: number) =>
    median * Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()));

  const now = Date.now();
  const rows: (typeof requestLogs.$inferInsert)[] = [];
  for (let at = now - HISTORY_DAYS * 24 * 60 * 60 * 1000; at < now; at += BUCKET_MS) {
    // Busier by day than by night.
    const hour = (at / (60 * 60 * 1000)) % 24;
    const load = 0.55 + 0.45 * Math.sin(((hour - 8) / 24) * 2 * Math.PI);
    const count = Math.round(MAX_REQUESTS_PER_BUCKET * load * (0.7 + random() * 0.6));

    for (let i = 0; i < count; i++) {
      const roll = random();
      const rateLimited = roll < 0.03;
      const failed = !rateLimited && roll < 0.05;
      const isPost = random() < 0.25;
      rows.push({
        requestId: randomUUID(),
        tenantId: DEMO_TENANT_ID,
        apiKeyId: DEMO_API_KEY_ID,
        method: isPost ? "POST" : "GET",
        routePrefix: DEMO_ROUTE_PREFIXES[Math.floor(random() * DEMO_ROUTE_PREFIXES.length)],
        statusCode: rateLimited ? 429 : failed ? 502 : isPost ? 201 : 200,
        latencyMs: rateLimited ? 1 : Math.max(1, Math.round(logNormal(isPost ? 120 : 60, 0.6))),
        requestBytes: isPost ? Math.round(logNormal(800, 0.8)) : 0,
        responseBytes: rateLimited ? 90 : Math.round(logNormal(isPost ? 400 : 3000, 0.8)),
        rateLimited,
        upstreamCalled: !rateLimited,
        createdAt: new Date(at + random() * BUCKET_MS),
      });
    }
  }
  return rows;
};

const seed = async () => {
  assertLocalDatabase(env.DATABASE_URL);

  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, DEMO_TENANT_ID));
  if (existing && !process.argv.includes("--reset")) {
    process.stdout.write("Demo tenant already exists, nothing to do (use --reset to recreate it)\n");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const rows = historyRows();
  // One transaction: a crash cannot leave a partial demo that later runs then skip.
  await db.transaction(async (tx) => {
    if (existing) {
      await tx.delete(tenants).where(eq(tenants.id, DEMO_TENANT_ID));
      // request_logs has no foreign key, so the cascade does not reach it.
      await tx.delete(requestLogs).where(eq(requestLogs.tenantId, DEMO_TENANT_ID));
    }
    await tx.insert(tenants).values({ id: DEMO_TENANT_ID, name: "Acme Payments (demo)", plan: "pro" });
    await tx.insert(users).values([
      { tenantId: DEMO_TENANT_ID, email: DEMO_ADMIN_EMAIL, passwordHash, role: "admin" },
      { tenantId: DEMO_TENANT_ID, email: DEMO_VIEWER_EMAIL, passwordHash, role: "viewer" },
    ]);
    await tx.insert(apiKeys).values({
      id: DEMO_API_KEY_ID,
      tenantId: DEMO_TENANT_ID,
      name: "Demo traffic",
      keyHash: hashKey(DEMO_API_KEY),
      hint: `${DEMO_API_KEY.slice(0, 12)}...${DEMO_API_KEY.slice(-4)}`,
    });
    await tx.insert(gatewayRoutes).values(
      DEMO_ROUTE_PREFIXES.map((pathPrefix) => ({
        tenantId: DEMO_TENANT_ID,
        pathPrefix,
        targetUrl: upstreamUrl,
      })),
    );
    await tx.insert(rateLimitConfigs).values({
      tenantId: DEMO_TENANT_ID,
      strategy: "token_bucket",
      capacity: 100,
      refillRate: 20,
      windowMs: 60_000,
    });
    // The flaky receiver fails half the time, so the delivery log shows real retries.
    await tx.insert(webhookEndpoints).values(
      ["/webhook-sink", "/webhook-flaky"].map((path) => ({
        tenantId: DEMO_TENANT_ID,
        url: `${upstreamUrl}${path}`,
        encryptedSecret: encryptSecret(DEMO_WEBHOOK_SECRET),
      })),
    );
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await tx.insert(requestLogs).values(rows.slice(i, i + BATCH_SIZE));
    }
  });

  process.stdout.write(
    `Seeded demo tenant with ${rows.length} synthetic request log rows. Sign in as ${DEMO_ADMIN_EMAIL}\n`,
  );
};

try {
  await seed();
  await closeDb();
  // The auth service's imports hold Redis open, and this script is finished.
  process.exit(0);
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
