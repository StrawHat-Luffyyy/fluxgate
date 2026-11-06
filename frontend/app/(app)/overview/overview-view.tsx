"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { CHART_HEIGHT, ChartMessage, TimeChart, type ChartSeries } from "@/components/charts";
import { ErrorState, PageHeader, Panel, Skeleton, StaleBanner } from "@/components/ui/primitives";
import { CopyButton } from "@/components/ui/secret-dialog";
import { Segmented } from "@/components/ui/switch";
import { TableWrap } from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api";
import {
  BUCKET_LABEL,
  formatBucket,
  formatCompact,
  formatCount,
  formatLatency,
  formatPercent,
  formatPercentTick,
  RANGE_LABEL,
} from "@/lib/format";
import { useKeys, useOverview, useRoutes } from "@/lib/queries";
import type { AnalyticsOverview, AnalyticsRange, OverviewBucket } from "@/lib/types";

const RANGES = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;

const parseRange = (raw: string | null): AnalyticsRange =>
  raw === "1h" || raw === "7d" ? raw : "24h";

// Charts in a row share a baseline, even when one panel's description wraps.
const CHART_BODY = "flex flex-col justify-end";

type ChartRow = OverviewBucket & { errorRate: number | null };

const TRAFFIC: ChartSeries<ChartRow>[] = [
  { key: "requests", label: "Requests", color: "var(--chart-1)" },
];
const LATENCY: ChartSeries<ChartRow>[] = [
  { key: "p50LatencyMs", label: "p50", color: "var(--chart-1)" },
  { key: "p95LatencyMs", label: "p95", color: "var(--chart-2)" },
  { key: "p99LatencyMs", label: "p99", color: "var(--chart-3)" },
];
const ERROR_RATE: ChartSeries<ChartRow>[] = [
  { key: "errorRate", label: "5xx error rate", color: "var(--chart-bad)" },
];
const RATE_LIMITED: ChartSeries<ChartRow>[] = [
  { key: "rateLimited", label: "Rate limited", color: "var(--chart-warn)" },
];

function Stat({
  label,
  value,
  detail,
  className = "",
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-surface px-4 py-3 ${className}`} data-testid={`stat-${label}`}>
      <dt className="text-xs text-fg-2">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="min-h-[18px] text-xs text-fg-3 tabular-nums">{detail}</dd>
    </div>
  );
}

function StatStrip({ overview }: { overview: AnalyticsOverview | undefined }) {
  const s = overview?.summary;
  const pending = <Skeleton className="my-1 h-6 w-16" />;
  const rateLimitedShare = s && s.totalRequests > 0 ? s.rateLimitedCount / s.totalRequests : null;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-5">
      <Stat
        label="Requests"
        value={s ? formatCount(s.totalRequests) : pending}
        detail={overview && RANGE_LABEL[overview.range]}
      />
      <Stat
        label="Error rate"
        value={s ? formatPercent(s.totalRequests > 0 ? s.errorRate : null) : pending}
        detail={s && `${formatCount(s.errorCount)} 5xx`}
      />
      <Stat
        label="p95 latency"
        value={s ? formatLatency(s.p95LatencyMs) : pending}
        detail={s && `p50 ${formatLatency(s.p50LatencyMs)} · p99 ${formatLatency(s.p99LatencyMs)}`}
      />
      <Stat
        label="Rate limited"
        value={s ? formatCount(s.rateLimitedCount) : pending}
        detail={s && (rateLimitedShare === null ? "no requests" : `${formatPercent(rateLimitedShare)} of requests`)}
      />
      <Stat
        className="col-span-2 lg:col-span-1"
        label="Anomalies"
        value={s ? formatCount(s.totalAnomalies) : pending}
        detail={
          s && (
            <Link href="/anomalies" className="underline hover:text-fg">
              {formatCount(s.openAnomalies)} open
            </Link>
          )
        }
      />
    </dl>
  );
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${done ? "text-ok" : "text-fg-3"}`} />
      <span className={done ? "text-fg-2" : "text-fg"}>
        {done && <span className="sr-only">Done: </span>}
        {children}
      </span>
    </li>
  );
}

/** Shown instead of empty charts. Each step's state comes from the workspace's real data. */
function NoTraffic({ range }: { range: AnalyticsRange }) {
  const routes = useRoutes();
  const keys = useKeys();
  const route = routes.data?.[0];
  const hasKey = keys.data?.some((key) => !key.revokedAt) ?? false;
  const curl = `curl -H "Authorization: Bearer <your API key>" ${API_BASE_URL}/gateway${route?.pathPrefix ?? "/<prefix>"}/`;
  return (
    <Panel
      title={`No traffic in the ${RANGE_LABEL[range]}`}
      description="Charts appear once requests pass through the gateway."
    >
      <ul className="flex flex-col gap-2">
        <Step done={Boolean(route)}>
          <Link href="/routes" className="underline">
            Create a route
          </Link>{" "}
          from a path prefix to your upstream.
        </Step>
        <Step done={hasKey}>
          <Link href="/keys" className="underline">
            Create an API key
          </Link>{" "}
          for the client that will call it.
        </Step>
        <Step done={false}>Send a request through the gateway:</Step>
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs break-all">
          {curl}
        </code>
        <CopyButton value={curl} />
      </div>
    </Panel>
  );
}

function BucketTable({ rows }: { rows: ChartRow[] }) {
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="rounded-lg px-4 py-3 text-sm font-medium">
        Chart data as a table
      </summary>
      <TableWrap label="Traffic per time bucket" className="max-h-96 overflow-y-auto border-t border-line">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col" className="num">Requests</th>
            <th scope="col" className="num">5xx</th>
            <th scope="col" className="num">Error rate</th>
            <th scope="col" className="num">Rate limited</th>
            <th scope="col" className="num">p50</th>
            <th scope="col" className="num">p95</th>
            <th scope="col" className="num">p99</th>
            <th scope="col" className="num">Anomalies</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.time}>
              <td className="whitespace-nowrap">{formatBucket(row.time)}</td>
              <td className="num">{formatCount(row.requests)}</td>
              <td className="num">{formatCount(row.errors)}</td>
              <td className="num">{formatPercent(row.errorRate)}</td>
              <td className="num">{formatCount(row.rateLimited)}</td>
              <td className="num whitespace-nowrap">{formatLatency(row.p50LatencyMs)}</td>
              <td className="num whitespace-nowrap">{formatLatency(row.p95LatencyMs)}</td>
              <td className="num whitespace-nowrap">{formatLatency(row.p99LatencyMs)}</td>
              <td className="num">{formatCount(row.anomalies)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </details>
  );
}

function Charts({ overview }: { overview: AnalyticsOverview }) {
  const { range, summary } = overview;
  const rows = useMemo<ChartRow[]>(
    () =>
      overview.timeSeries.map((bucket) => ({
        ...bucket,
        errorRate: bucket.requests > 0 ? bucket.errors / bucket.requests : null,
      })),
    [overview.timeSeries],
  );
  const bucket = BUCKET_LABEL[range];
  // The window starts and ends mid-bucket, so those two cover less time than the rest.
  const partial = "First and last buckets are partial.";
  const maxErrorRate = Math.max(...rows.map((row) => row.errorRate ?? 0));
  const window = RANGE_LABEL[range];

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Traffic" bodyClassName={CHART_BODY} description={`Requests ${bucket}. ${partial}`}>
          <TimeChart
            kind="bar"
            label={`Requests ${bucket}, ${formatCount(summary.totalRequests)} in the ${window}`}
            data={rows}
            series={TRAFFIC}
            range={range}
            formatValue={(value) => formatCount(value ?? 0)}
            formatTick={formatCompact}
          />
        </Panel>

        <Panel
          title="Latency"
          bodyClassName={CHART_BODY}
          description={`Gateway latency of upstream requests, ${bucket}. ${partial}`}
          aside={
            <ul className="flex items-center gap-3 text-xs text-fg-2">
              {LATENCY.map((series) => (
                <li key={series.key} className="flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: series.color }} />
                  {series.label}
                </li>
              ))}
            </ul>
          }
        >
          {summary.p50LatencyMs === null ? (
            <ChartMessage>
              No request reached an upstream in the {window}, so there is no latency to show.
            </ChartMessage>
          ) : (
            <TimeChart
              kind="line"
              label={`Latency percentiles ${bucket}. Overall p50 ${formatLatency(summary.p50LatencyMs)}, p95 ${formatLatency(summary.p95LatencyMs)}, p99 ${formatLatency(summary.p99LatencyMs)}`}
              data={rows}
              series={LATENCY}
              range={range}
              formatValue={formatLatency}
              formatTick={(value) =>
                value >= 1000 ? `${Number((value / 1000).toFixed(1))} s` : `${value} ms`
              }
            />
          )}
        </Panel>

        <Panel title="Error rate" bodyClassName={CHART_BODY} description={`Share of requests answered 5xx, ${bucket}. ${partial}`}>
          {summary.errorCount === 0 ? (
            <ChartMessage>No 5xx responses in the {window}.</ChartMessage>
          ) : (
            <TimeChart
              kind="line"
              label={`5xx error rate ${bucket}, ${formatPercent(summary.errorRate)} overall`}
              data={rows}
              series={ERROR_RATE}
              range={range}
              formatValue={formatPercent}
              fractional
              formatTick={(value) => formatPercentTick(value, maxErrorRate)}
            />
          )}
        </Panel>

        <Panel title="Rate-limit hits" bodyClassName={CHART_BODY} description={`Requests answered 429, ${bucket}. ${partial}`}>
          {summary.rateLimitedCount === 0 ? (
            <ChartMessage>No requests were rate limited in the {window}.</ChartMessage>
          ) : (
            <TimeChart
              kind="bar"
              label={`Rate limited requests ${bucket}, ${formatCount(summary.rateLimitedCount)} in the ${window}`}
              data={rows}
              series={RATE_LIMITED}
              range={range}
              formatValue={(value) => formatCount(value ?? 0)}
              formatTick={formatCompact}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Top routes" description="By requests" flush>
          {overview.topRoutes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-3">No routed traffic in the {window}.</p>
          ) : (
            <TableWrap label="Top routes">
              <thead>
                <tr>
                  <th scope="col">Prefix</th>
                  <th scope="col" className="num">Requests</th>
                  <th scope="col" className="num">5xx</th>
                  <th scope="col" className="num">p95</th>
                </tr>
              </thead>
              <tbody>
                {overview.topRoutes.map((route) => (
                  <tr key={route.routePrefix}>
                    <td className="font-mono text-xs">{route.routePrefix}</td>
                    <td className="num">{formatCount(route.requests)}</td>
                    <td className="num">{formatCount(route.errors)}</td>
                    <td className="num whitespace-nowrap">{formatLatency(route.p95LatencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Top consumers" description="API keys by requests" flush>
          {overview.topConsumers.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-3">No authenticated traffic in the {window}.</p>
          ) : (
            <TableWrap label="Top consumers">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col" className="num">Requests</th>
                  <th scope="col" className="num">Rate limited</th>
                </tr>
              </thead>
              <tbody>
                {overview.topConsumers.map((consumer) => (
                  <tr key={consumer.apiKeyId}>
                    <td>
                      {consumer.name}
                      {consumer.hint && (
                        <span className="block font-mono text-xs text-fg-3">{consumer.hint}</span>
                      )}
                    </td>
                    <td className="num">{formatCount(consumer.requests)}</td>
                    <td className="num">{formatCount(consumer.rateLimited)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>

      <BucketTable rows={rows} />
    </>
  );
}

function ChartsSkeleton() {
  return (
    <div role="status" aria-label="Loading charts" className="grid gap-3 lg:grid-cols-2">
      {["Traffic", "Latency", "Error rate", "Rate-limit hits"].map((title) => (
        <Panel key={title} title={title} description="Loading">
          <div style={{ height: CHART_HEIGHT }} className="fg-skeleton" />
        </Panel>
      ))}
    </div>
  );
}

export function OverviewView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = parseRange(params.get("range"));
  const { data, dataUpdatedAt, error, isPending, refetch } = useOverview(range);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Overview"
        description="Measured from this workspace's gateway request logs."
        actions={
          <Segmented
            label="Time range"
            value={range}
            options={RANGES}
            onChange={(next) => router.replace(`${pathname}?range=${next}`, { scroll: false })}
          />
        }
      />
      {error && !data ? (
        <Panel flush>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Panel>
      ) : (
        <>
          {error && <StaleBanner error={error} updatedAt={dataUpdatedAt} />}
          <StatStrip overview={data} />
          {isPending || !data ? (
            <ChartsSkeleton />
          ) : data.summary.totalRequests === 0 ? (
            <NoTraffic range={data.range} />
          ) : (
            <Charts overview={data} />
          )}
        </>
      )}
    </div>
  );
}
