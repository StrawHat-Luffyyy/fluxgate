import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { anomalies, tenants } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";
import { createDeliveries, enqueueDeliveries } from "./webhook.service.js";

const log = createChildLogger("anomaly-service");

export type AnomalyStatus = "open" | "acknowledged" | "resolved";

export interface AlertInput {
  tenantId: string;
  alertType: string;
  requestId: string;
  detector: string;
  score: number;
  modelVersion: string;
  topFeature: string;
  topFeatureValue: number;
  attribution: Record<string, number>;
  features: Record<string, number>;
  message: string;
  detectedAt: string;
}

/**
 * Stores the anomaly and its webhook deliveries in one transaction (an outbox), so
 * a crash cannot leave an anomaly whose webhook is never sent. The unique
 * (tenant, requestId) makes this idempotent: Kafka is at-least-once, and a
 * redelivered message must not alert twice.
 */
export async function recordAnomaly(alert: AlertInput) {
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, alert.tenantId))
    .limit(1);
  // A 404 is a permanent failure to ai-service, which sends the message to its DLQ.
  if (!tenant) throw AppError.notFound("Tenant not found", "TENANT_NOT_FOUND");

  const result = await db.transaction(async (tx) => {
    const [anomaly] = await tx
      .insert(anomalies)
      .values({
        tenantId: alert.tenantId,
        requestId: alert.requestId,
        detector: alert.detector,
        score: alert.score,
        modelVersion: alert.modelVersion,
        topFeature: alert.topFeature,
        topFeatureValue: alert.topFeatureValue,
        attribution: alert.attribution,
        features: alert.features,
        message: alert.message,
        detectedAt: new Date(alert.detectedAt),
      })
      .onConflictDoNothing({ target: [anomalies.tenantId, anomalies.requestId] })
      .returning();
    if (!anomaly) return null;

    const deliveries = await createDeliveries(tx, alert.tenantId, "anomaly.detected", {
      anomalyId: anomaly.id,
      ...alert,
    });
    return { anomaly, deliveries };
  });

  if (!result) {
    log.debug({ requestId: alert.requestId }, "Duplicate alert ignored");
    return { created: false, deliveries: 0 };
  }
  await enqueueDeliveries(result.deliveries);
  log.info(
    { tenantId: alert.tenantId, anomalyId: result.anomaly.id, topFeature: alert.topFeature },
    "Anomaly recorded",
  );
  return { created: true, deliveries: result.deliveries.length };
}

export interface AnomalyCursor {
  detectedAt: Date;
  id: string;
}

export async function listAnomalies(
  tenantId: string,
  options: { status?: AnomalyStatus; cursor?: AnomalyCursor; limit: number },
) {
  const conditions = [eq(anomalies.tenantId, tenantId)];
  if (options.status) conditions.push(eq(anomalies.status, options.status));
  if (options.cursor) {
    // Compared as a pair: rows sharing a timestamp at a page boundary are not skipped.
    conditions.push(
      sql`(${anomalies.detectedAt}, ${anomalies.id}) < (${options.cursor.detectedAt.toISOString()}::timestamptz, ${options.cursor.id}::uuid)`,
    );
  }
  return db
    .select()
    .from(anomalies)
    .where(and(...conditions))
    .orderBy(desc(anomalies.detectedAt), desc(anomalies.id))
    .limit(options.limit);
}

export async function updateAnomalyStatus(
  tenantId: string,
  anomalyId: string,
  status: AnomalyStatus,
) {
  const [anomaly] = await db
    .update(anomalies)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(anomalies.id, anomalyId), eq(anomalies.tenantId, tenantId)))
    .returning();
  if (!anomaly) throw AppError.notFound("Anomaly not found");
  return anomaly;
}
