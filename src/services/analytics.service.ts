import { sql } from "drizzle-orm";
import { analyticsDb } from "../db/index.js";
import { AppError } from "../lib/AppError.js";
import { cacheGet, cacheSet } from "../redis/cache.js";

export const ANALYTICS_RANGES = {
  "1h": { ms: 60 * 60 * 1000, bucket: "1 minute" },
  "24h": { ms: 24 * 60 * 60 * 1000, bucket: "1 hour" },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, bucket: "6 hours" },
} as const;

export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

const TOP_N = 10;

type Row = Record<string, unknown>;

const CACHE_TTL_SECONDS = 10;
const STATEMENT_TIMEOUT_MS = 5_000;

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

// No traffic means no latency, which is different from a latency of zero.
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

// Latency percentiles count only requests that reached an upstream. A 429 answered
// in a millisecond says nothing about upstream latency and would flatter the p50.
const percentile = (fraction: number) =>
  sql.raw(
    `percentile_cont(${fraction}) within group (order by latency_ms) filter (where upstream_called)`,
  );

/**
 * Every number here is an aggregate of real rows in request_logs and anomalies.
 * The (tenant_id, created_at) index serves all of these, and the tenant filter is
 * in each query.
 */
const queryOverview = async (tenantId: string, range: AnalyticsRange) => {
  const { ms, bucket } = ANALYTICS_RANGES[range];
  const since = new Date(Date.now() - ms).toISOString();

  // One transaction: a consistent snapshot-free read on a single connection, with a
  // statement timeout set locally because connection poolers refuse it at startup.
  const [summary, anomalySummary, buckets, anomalyBuckets, routes, consumers] = await analyticsDb.transaction(async (db) => {
    await db.execute(sql.raw(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`));
    return [
    await db.execute(sql`
      select
        count(*) as total,
        count(*) filter (where status_code >= 500) as errors,
        count(*) filter (where rate_limited) as rate_limited,
        avg(latency_ms) filter (where upstream_called) as avg_latency,
        ${percentile(0.5)} as p50,
        ${percentile(0.95)} as p95,
        ${percentile(0.99)} as p99
      from request_logs
      where tenant_id = ${tenantId} and created_at >= ${since}::timestamptz
    `),
    await db.execute(sql`
      select count(*) as total, count(*) filter (where status = 'open') as open
      from anomalies
      where tenant_id = ${tenantId} and detected_at >= ${since}::timestamptz
    `),
    // generate_series keeps empty buckets, so charts show gaps as zero traffic.
    await db.execute(sql`
      with buckets as (
        select generate_series(
          date_bin(${bucket}::interval, ${since}::timestamptz, 'epoch'::timestamptz),
          now(),
          ${bucket}::interval
        ) as bucket
      )
      select
        b.bucket as bucket,
        count(r.request_id) as requests,
        count(r.request_id) filter (where r.status_code >= 500) as errors,
        count(r.request_id) filter (where r.rate_limited) as rate_limited,
        percentile_cont(0.5) within group (order by r.latency_ms) filter (where r.upstream_called) as p50,
        percentile_cont(0.95) within group (order by r.latency_ms) filter (where r.upstream_called) as p95,
        percentile_cont(0.99) within group (order by r.latency_ms) filter (where r.upstream_called) as p99
      from buckets b
      left join request_logs r
        on r.tenant_id = ${tenantId}
        and r.created_at >= b.bucket
        and r.created_at < b.bucket + ${bucket}::interval
        and r.created_at >= ${since}::timestamptz
      group by b.bucket
      order by b.bucket
    `),
    await db.execute(sql`
      select date_bin(${bucket}::interval, detected_at, 'epoch'::timestamptz) as bucket, count(*) as total
      from anomalies
      where tenant_id = ${tenantId} and detected_at >= ${since}::timestamptz
      group by 1
    `),
    await db.execute(sql`
      select
        route_prefix,
        count(*) as requests,
        count(*) filter (where status_code >= 500) as errors,
        ${percentile(0.95)} as p95
      from request_logs
      where tenant_id = ${tenantId} and created_at >= ${since}::timestamptz
      group by route_prefix
      order by requests desc
      limit ${TOP_N}
    `),
    await db.execute(sql`
      select
        l.api_key_id,
        k.name,
        k.hint,
        count(*) as requests,
        count(*) filter (where l.rate_limited) as rate_limited
      from request_logs l
      left join api_keys k on k.id = l.api_key_id and k.tenant_id = ${tenantId}
      where l.tenant_id = ${tenantId} and l.created_at >= ${since}::timestamptz
      group by l.api_key_id, k.name, k.hint
      order by requests desc
      limit ${TOP_N}
    `),
    ] as const;
  });

  const totals = (summary as unknown as Row[])[0];
  const anomalyTotals = (anomalySummary as unknown as Row[])[0];
  const total = num(totals.total);

  const anomaliesByBucket = new Map(
    (anomalyBuckets as unknown as Row[]).map((row) => [
      new Date(row.bucket as string).getTime(),
      num(row.total),
    ]),
  );

  return {
    range,
    summary: {
      totalRequests: total,
      errorCount: num(totals.errors),
      errorRate: total === 0 ? 0 : num(totals.errors) / total,
      rateLimitedCount: num(totals.rate_limited),
      avgLatencyMs: numOrNull(totals.avg_latency),
      p50LatencyMs: numOrNull(totals.p50),
      p95LatencyMs: numOrNull(totals.p95),
      p99LatencyMs: numOrNull(totals.p99),
      totalAnomalies: num(anomalyTotals.total),
      openAnomalies: num(anomalyTotals.open),
    },
    timeSeries: (buckets as unknown as Row[]).map((row) => {
      const time = new Date(row.bucket as string);
      return {
        time: time.toISOString(),
        requests: num(row.requests),
        errors: num(row.errors),
        rateLimited: num(row.rate_limited),
        p50LatencyMs: numOrNull(row.p50),
        p95LatencyMs: numOrNull(row.p95),
        p99LatencyMs: numOrNull(row.p99),
        anomalies: anomaliesByBucket.get(time.getTime()) ?? 0,
      };
    }),
    topRoutes: (routes as unknown as Row[]).map((row) => ({
      routePrefix: row.route_prefix as string,
      requests: num(row.requests),
      errors: num(row.errors),
      p95LatencyMs: numOrNull(row.p95),
    })),
    topConsumers: (consumers as unknown as Row[]).map((row) => ({
      apiKeyId: row.api_key_id as string,
      name: (row.name as string | null) ?? "Unknown key",
      hint: (row.hint as string | null) ?? "",
      requests: num(row.requests),
      rateLimited: num(row.rate_limited),
    })),
  };
};

export type AnalyticsOverview = Awaited<ReturnType<typeof queryOverview>>;

/** Cached briefly: dashboards poll, and this query sorts every row in the window. */
export async function getAnalyticsOverview(
  tenantId: string,
  range: AnalyticsRange = "24h",
): Promise<AnalyticsOverview> {
  const key = `fluxgate:analytics:${tenantId}:${range}`;
  const cached = await cacheGet(key);
  if (cached) return JSON.parse(cached) as AnalyticsOverview;

  try {
    const overview = await queryOverview(tenantId, range);
    await cacheSet(key, JSON.stringify(overview), CACHE_TTL_SECONDS);
    return overview;
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "57014") {
      throw AppError.serviceUnavailable("Analytics query timed out", "ANALYTICS_TIMEOUT");
    }
    throw err;
  }
}
