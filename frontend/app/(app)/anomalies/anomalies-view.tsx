"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Activity, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ReadOnlyNote,
  TableSkeleton,
  type BadgeTone,
} from "@/components/ui/primitives";
import { CopyIconButton } from "@/components/ui/secret-dialog";
import { Segmented } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, formatDateTime, formatLatency, formatRelative } from "@/lib/format";
import { queryKeys, useMe } from "@/lib/queries";
import type { Anomaly, AnomalyPage, AnomalyStatus } from "@/lib/types";

type Filter = "all" | AnomalyStatus;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
] as const;

const PAGE_SIZE = 25;
const listKey = (filter: Filter) => [...queryKeys.anomalies, "list", filter] as const;

const STATUS: Record<AnomalyStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "bad" },
  acknowledged: { label: "Acknowledged", tone: "warn" },
  resolved: { label: "Resolved", tone: "ok" },
};

// The wire names from RequestFeatures, in units a person can read. A feature the UI
// has not heard of still shows, under its raw name.
const FEATURES: Record<string, { label: string; format: (value: number) => string }> = {
  requestByteSize: { label: "Request size", format: formatBytes },
  responseByteSize: { label: "Response size", format: formatBytes },
  latencyMs: { label: "Latency", format: formatLatency },
};

const featureLabel = (name: string) => FEATURES[name]?.label ?? name;
const featureValue = (name: string, value: number) =>
  FEATURES[name]?.format(value) ?? String(value);

const DETECTORS: Record<string, string> = {
  forest: "Isolation Forest",
  range_guard: "Range guard",
};

/**
 * SHAP values share a scale but not a sign. Isolation Forest output falls as a point
 * gets easier to isolate, so a negative value is a push toward anomalous. Bars grow
 * out from a central zero, and each row also says which way it pushed.
 */
function Attribution({ attribution }: { attribution: Record<string, number> }) {
  const rows = Object.entries(attribution).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const max = Math.max(...rows.map(([, value]) => Math.abs(value)), Number.EPSILON);
  return (
    <ul className="flex flex-col gap-2" aria-label="SHAP attribution by feature">
      {rows.map(([name, value]) => {
        const width = `${(Math.abs(value) / max) * 50}%`;
        const anomalous = value < 0;
        return (
          <li key={name} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[7.5rem_1fr_11rem]">
            <span className="text-xs text-fg-2">{featureLabel(name)}</span>
            <div aria-hidden className="relative h-3">
              <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
              <span
                className="absolute inset-y-0.5 rounded-[2px]"
                style={{
                  width,
                  background: anomalous ? "var(--chart-2)" : "var(--chart-1)",
                  ...(anomalous ? { right: "50%" } : { left: "50%" }),
                }}
              />
            </div>
            <span className="text-right text-xs tabular-nums sm:text-left">
              <span className="font-medium">
                {value > 0 ? "+" : ""}
                {value.toFixed(3)}
              </span>
              <span className="hidden text-fg-3 sm:inline">
                {" "}
                {anomalous ? "toward anomalous" : "toward normal"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="text-sm break-words tabular-nums">{children}</dd>
    </div>
  );
}

function AnomalyDetail({
  anomaly,
  canEdit,
  onSetStatus,
}: {
  anomaly: Anomaly;
  canEdit: boolean;
  onSetStatus: (status: AnomalyStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-line bg-sunken px-4 py-4">
      <section aria-label="Why this was flagged">
        <h3 className="text-sm font-semibold">Why this was flagged</h3>
        <p className="mt-0.5 mb-3 max-w-[70ch] text-xs text-fg-2">
          SHAP values, in the model&apos;s log scale rather than bytes or milliseconds. Negative
          values moved this request toward anomalous, positive values toward normal.
          {anomaly.detector === "range_guard" &&
            " The range guard flagged this because a feature was far above anything seen in training, so the named feature comes from that check, not from the largest SHAP value."}
        </p>
        <Attribution attribution={anomaly.attribution} />
      </section>

      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(anomaly.features).map(([name, value]) => (
          <Fact key={name} label={featureLabel(name)}>
            {featureValue(name, value)}
          </Fact>
        ))}
        <Fact label="Detector">{DETECTORS[anomaly.detector] ?? anomaly.detector}</Fact>
        <Fact label="Model score">{anomaly.score.toFixed(3)}</Fact>
        <Fact label="Model version">
          <span className="font-mono text-xs">{anomaly.modelVersion}</span>
        </Fact>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex min-w-0 items-center gap-1 text-xs text-fg-3">
          <span className="min-w-0 break-all">
            Request <span className="font-mono">{anomaly.requestId}</span>
          </span>
          <CopyIconButton value={anomaly.requestId} label="Copy request ID" />
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {anomaly.status === "open" && (
              <Button size="sm" onClick={() => onSetStatus("acknowledged")}>
                Acknowledge
              </Button>
            )}
            {anomaly.status !== "resolved" && (
              <Button size="sm" onClick={() => onSetStatus("resolved")}>
                Resolve
              </Button>
            )}
            {anomaly.status !== "open" && (
              <Button size="sm" onClick={() => onSetStatus("open")}>
                Reopen
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AnomalyRow({
  anomaly,
  canEdit,
  onSetStatus,
}: {
  anomaly: Anomaly;
  canEdit: boolean;
  onSetStatus: (status: AnomalyStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = STATUS[anomaly.status];
  return (
    <li data-testid="anomaly-row">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-hover"
      >
        <ChevronRight
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 text-fg-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm break-words">{anomaly.message}</span>
          <span className="mt-0.5 block text-xs text-fg-3">
            {featureLabel(anomaly.topFeature)}{" "}
            <span className="tabular-nums">
              {featureValue(anomaly.topFeature, anomaly.topFeatureValue)}
            </span>{" "}
            · {DETECTORS[anomaly.detector] ?? anomaly.detector}
            {" · "}
            <time dateTime={anomaly.detectedAt} title={formatDateTime(anomaly.detectedAt)}>
              {formatRelative(anomaly.detectedAt)}
            </time>
          </span>
        </span>
        <span className="shrink-0">
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </button>
      {open && <AnomalyDetail anomaly={anomaly} canEdit={canEdit} onSetStatus={onSetStatus} />}
    </li>
  );
}

const EMPTY_COPY: Record<Filter, string> = {
  all: "When the detection service flags a request from this workspace, it appears here with an explanation of why. No anomaly has been recorded yet.",
  open: "No anomaly is waiting for attention.",
  acknowledged: "No anomaly is currently acknowledged.",
  resolved: "No anomaly has been resolved yet.",
};

type Pages = InfiniteData<AnomalyPage, string | undefined>;

export function AnomaliesView() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role === "admin";
  const [filter, setFilter] = useState<Filter>("all");

  const query = useInfiniteQuery({
    queryKey: listKey(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (filter !== "all") params.set("status", filter);
      if (pageParam) params.set("cursor", pageParam);
      return api<AnomalyPage>(`/anomalies?${params}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AnomalyStatus }) =>
      api(`/anomalies/${id}`, { method: "PATCH", body: { status } }),
    // Optimistic in every cached filter: triage should feel instant, and a failure
    // restores exactly what was there.
    onMutate: async ({ id, status }) => {
      const prefix = [...queryKeys.anomalies, "list"];
      await client.cancelQueries({ queryKey: prefix });
      const previous = client.getQueriesData<Pages>({ queryKey: prefix });
      for (const [key, data] of previous) {
        if (!data) continue;
        const keyFilter = key[2] as Filter;
        client.setQueryData<Pages>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            anomalies: page.anomalies
              .map((row) => (row.id === id ? { ...row, status } : row))
              .filter((row) => keyFilter === "all" || row.status === keyFilter),
          })),
        });
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      context?.previous.forEach(([key, data]) => client.setQueryData(key, data));
      toast.error(errorMessage(err));
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.anomalies }),
  });

  const anomalies = query.data?.pages.flatMap((page) => page.anomalies) ?? [];

  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Requests the detection model flagged as unusual, with the features that drove each decision."
        actions={me && !canEdit ? <ReadOnlyNote /> : undefined}
      />
      <div className="mb-3 overflow-x-auto">
        <Segmented label="Filter by status" value={filter} options={FILTERS} onChange={setFilter} />
      </div>
      <Panel flush>
        {query.isPending ? (
          <TableSkeleton />
        ) : query.isError && anomalies.length === 0 ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : anomalies.length === 0 ? (
          <EmptyState icon={Activity} title="Nothing here">
            {EMPTY_COPY[filter]}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {anomalies.map((anomaly) => (
              <AnomalyRow
                key={anomaly.id}
                anomaly={anomaly}
                canEdit={canEdit}
                onSetStatus={(status) => setStatus.mutate({ id: anomaly.id, status })}
              />
            ))}
          </ul>
        )}
      </Panel>
      {query.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            Load older anomalies
          </Button>
        </div>
      )}
    </>
  );
}
