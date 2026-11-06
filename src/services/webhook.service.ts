import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { webhookDeliveries, webhookEndpoints } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";
import { encryptSecret } from "../lib/secretBox.js";
import { assertPublicUrl } from "../lib/ssrf.js";
import { enqueueDelivery, enqueueRetry } from "../queue/webhookQueue.js";

const log = createChildLogger("webhook-service");

const publicEndpoint = {
  id: webhookEndpoints.id,
  url: webhookEndpoints.url,
  enabledAt: webhookEndpoints.enabledAt,
  createdAt: webhookEndpoints.createdAt,
  updatedAt: webhookEndpoints.updatedAt,
};

export const listEndpoints = (tenantId: string) =>
  db
    .select(publicEndpoint)
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, tenantId))
    .orderBy(desc(webhookEndpoints.createdAt));

/** The signing secret is returned once, here, like an API key. */
export async function createEndpoint(tenantId: string, url: string) {
  await assertPublicUrl(url);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({ tenantId, url, encryptedSecret: encryptSecret(secret) })
    .returning(publicEndpoint);
  log.info({ tenantId, endpointId: endpoint.id }, "Webhook endpoint created");
  return { endpoint, secret };
}

export async function updateEndpoint(
  tenantId: string,
  endpointId: string,
  changes: { url?: string; enabled?: boolean },
) {
  if (changes.url) await assertPublicUrl(changes.url);
  const [endpoint] = await db
    .update(webhookEndpoints)
    .set({
      ...(changes.url ? { url: changes.url } : {}),
      ...(changes.enabled === undefined
        ? {}
        : { enabledAt: changes.enabled ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.tenantId, tenantId)))
    .returning(publicEndpoint);
  if (!endpoint) throw AppError.notFound("Webhook endpoint not found");
  return endpoint;
}

export async function deleteEndpoint(tenantId: string, endpointId: string) {
  const removed = await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.tenantId, tenantId)))
    .returning({ id: webhookEndpoints.id });
  if (removed.length === 0) throw AppError.notFound("Webhook endpoint not found");
}

export const listDeliveries = (tenantId: string, limit = 50) =>
  db
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      eventType: webhookDeliveries.eventType,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.tenantId, tenantId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);

type DbOrTx = Pick<typeof db, "select" | "insert">;

/**
 * Creates one delivery row per enabled endpoint. Takes a transaction so the rows
 * commit together with the event that caused them (a transactional outbox).
 */
export async function createDeliveries(
  tx: DbOrTx,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), isNotNull(webhookEndpoints.enabledAt)));
  if (endpoints.length === 0) return [];

  return tx
    .insert(webhookDeliveries)
    .values(endpoints.map(({ id }) => ({ tenantId, endpointId: id, eventType, payload })))
    .returning({ id: webhookDeliveries.id });
}

/** Call after commit. Failures are left for the sweeper. */
export const enqueueDeliveries = (deliveries: { id: string }[]) =>
  Promise.all(deliveries.map(({ id }) => enqueueDelivery(id)));

export async function sendTestEvent(tenantId: string, endpointId: string) {
  const [endpoint] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.tenantId, tenantId)))
    .limit(1);
  if (!endpoint) throw AppError.notFound("Webhook endpoint not found");

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      tenantId,
      endpointId,
      eventType: "webhook.test",
      payload: { message: "Test event from FluxGate" },
    })
    .returning({ id: webhookDeliveries.id });
  await enqueueDelivery(delivery.id);
  return delivery;
}

export async function retryDelivery(tenantId: string, deliveryId: string) {
  const [delivery] = await db
    .update(webhookDeliveries)
    .set({ status: "pending", attempts: 0, lastError: null, updatedAt: new Date() })
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.tenantId, tenantId),
        eq(webhookDeliveries.status, "dead"),
      ),
    )
    .returning({ id: webhookDeliveries.id });
  if (!delivery) throw AppError.notFound("Dead delivery not found");
  await enqueueRetry(delivery.id);
  return delivery;
}
