import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { requestLogs } from "../db/schema.js";
import { createChildLogger } from "../lib/logger.js";
import { telemetryDropped } from "../monitoring/metrics.js";
import type { RequestFeatures } from "../proxy/extractor.js";

const log = createChildLogger("request-log-writer");

const MAX_BUFFERED = 50_000;
const MAX_BATCH = 2_000;
const FLUSH_INTERVAL_MS = 1_000;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_BATCH = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_DAYS = 7;
export const ANOMALY_RETENTION_DAYS = 90;
export const DELIVERY_RETENTION_DAYS = 30;

let buffer: RequestFeatures[] = [];
let flushTimer: NodeJS.Timeout | undefined;
let retentionTimer: NodeJS.Timeout | undefined;
let flushing: Promise<void> | undefined;

/**
 * Inserting per request would add a Postgres round trip to the hot path. Batching
 * bounds that cost, and the bounded buffer means a long Postgres outage costs
 * analytics data (counted in a metric) rather than memory.
 */
export const enqueueRequestLog = (features: RequestFeatures): void => {
  if (buffer.length >= MAX_BUFFERED) {
    buffer.shift();
    telemetryDropped.inc({ sink: "postgres" });
  }
  buffer.push(features);
};

const writeBatch = (batch: RequestFeatures[]) =>
  db
    .insert(requestLogs)
    .values(
      batch.map((row) => ({
        requestId: row.requestId,
        tenantId: row.tenantId,
        apiKeyId: row.apiKeyId,
        method: row.method,
        routePrefix: row.routePrefix,
        statusCode: row.statusCode,
        latencyMs: row.latencyMs,
        requestBytes: row.requestByteSize,
        responseBytes: row.responseByteSize,
        rateLimited: row.rateLimited,
        upstreamCalled: row.upstreamCalled,
        createdAt: new Date(row.timestamp),
      })),
    )
    .onConflictDoNothing();

/** Postgres SQLSTATE classes 22 and 23: the data is bad, so retrying cannot help. */
const isDataError = (err: unknown): boolean => {
  let current = err as { code?: unknown; cause?: unknown } | undefined;
  while (current) {
    if (typeof current.code === "string" && /^2[23]/.test(current.code)) return true;
    current = current.cause as typeof current;
  }
  return false;
};

/**
 * A batch insert is atomic, so a single unstorable row would fail it for every
 * tenant. Bisecting isolates that row and costs only log2(batch) extra inserts.
 */
const writeIsolatingBadRows = async (batch: RequestFeatures[]): Promise<void> => {
  try {
    await writeBatch(batch);
  } catch (err) {
    if (!isDataError(err)) throw err;
    if (batch.length === 1) {
      telemetryDropped.inc({ sink: "postgres" });
      log.warn({ err, requestId: batch[0].requestId }, "Dropped an unstorable request log");
      return;
    }
    const middle = Math.floor(batch.length / 2);
    await writeIsolatingBadRows(batch.slice(0, middle));
    await writeIsolatingBadRows(batch.slice(middle));
  }
};

const requeue = (batch: RequestFeatures[]) => {
  buffer = batch.concat(buffer);
  const excess = buffer.length - MAX_BUFFERED;
  if (excess > 0) {
    buffer = buffer.slice(excess);
    telemetryDropped.inc({ sink: "postgres" }, excess);
  }
};

/** Writes until empty. Stops at a connection failure, keeping rows for the next tick. */
const drain = async () => {
  while (buffer.length > 0) {
    const batch = buffer.slice(0, MAX_BATCH);
    buffer = buffer.slice(batch.length);
    try {
      await writeIsolatingBadRows(batch);
    } catch (err) {
      requeue(batch);
      log.error({ err, buffered: buffer.length }, "Failed to write request logs, will retry");
      return;
    }
  }
};

const scheduledDrain = () => {
  if (!flushing) {
    flushing = drain().finally(() => {
      flushing = undefined;
    });
  }
  return flushing;
};

/** Writes what is buffered now. Also what tests call instead of waiting. */
export const flushRequestLogs = async () => {
  await flushing;
  await scheduledDrain();
};

const deleteInBatches = async (query: ReturnType<typeof sql>) => {
  // Small batches keep locks short, so retention cannot stall the writer.
  for (;;) {
    const result = (await db.execute(query)) as unknown as { count?: number };
    if (!result.count) return;
  }
};

export const runRetention = async (now = Date.now()) => {
  const logsBefore = new Date(now - RETENTION_DAYS * DAY_MS).toISOString();
  const anomaliesBefore = new Date(now - ANOMALY_RETENTION_DAYS * DAY_MS).toISOString();
  const deliveriesBefore = new Date(now - DELIVERY_RETENTION_DAYS * DAY_MS).toISOString();

  await deleteInBatches(sql`
    delete from request_logs where request_id in (
      select request_id from request_logs
      where created_at < ${logsBefore}::timestamptz limit ${RETENTION_BATCH}
    )
  `);
  await deleteInBatches(sql`
    delete from anomalies where id in (
      select id from anomalies
      where detected_at < ${anomaliesBefore}::timestamptz limit ${RETENTION_BATCH}
    )
  `);
  await deleteInBatches(sql`
    delete from webhook_deliveries where id in (
      select id from webhook_deliveries
      where created_at < ${deliveriesBefore}::timestamptz limit ${RETENTION_BATCH}
    )
  `);
};

const retentionTick = () =>
  runRetention().catch((err) => log.warn({ err }, "Retention run failed"));

export const startRequestLogWriter = () => {
  flushTimer = setInterval(() => void scheduledDrain(), FLUSH_INTERVAL_MS);
  flushTimer.unref();

  // Also at startup: an instance restarted more often than hourly would never run it.
  void retentionTick();
  retentionTimer = setInterval(() => void retentionTick(), RETENTION_INTERVAL_MS);
  retentionTimer.unref();
};

export const stopRequestLogWriter = async () => {
  clearInterval(flushTimer);
  clearInterval(retentionTimer);
  await flushRequestLogs();
};
