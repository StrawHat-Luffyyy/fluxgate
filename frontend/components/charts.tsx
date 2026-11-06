"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBucket } from "@/lib/format";
import type { AnalyticsRange } from "@/lib/types";

export const CHART_HEIGHT = 208;

export interface ChartSeries<Row> {
  key: keyof Row & string;
  label: string;
  color: string;
}

const axisTick = { fontSize: 11, fill: "var(--fg-3)" };

interface TooltipEntry {
  dataKey?: unknown;
  value?: unknown;
}

function ChartTooltip<Row>({
  active,
  payload,
  label,
  range,
  series,
  format,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  range: AnalyticsRange;
  series: ChartSeries<Row>[];
  format: (value: number | null) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-strong bg-surface px-2.5 py-2 text-xs shadow-pop">
      <p className="mb-1 text-fg-3">{formatBucket(String(label), range)}</p>
      <ul className="flex flex-col gap-0.5 tabular-nums">
        {series.map((entry) => {
          const value = payload.find((item) => item.dataKey === entry.key)?.value;
          return (
            <li key={entry.key} className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-fg-2">
                <span
                  aria-hidden
                  className="size-2 rounded-[2px]"
                  style={{ background: entry.color }}
                />
                {entry.label}
              </span>
              <span className="ml-auto font-medium text-fg">
                {format(typeof value === "number" ? value : null)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One time axis, one value axis. Bars for counts per bucket, lines for rates and
 * latency. Animation is off: this redraws on every poll, and motion would suggest
 * a change that did not happen.
 */
export function TimeChart<Row extends { time: string }>({
  kind,
  label,
  data,
  series,
  range,
  formatValue,
  formatTick,
  fractional = false,
}: {
  kind: "bar" | "line";
  label: string;
  data: Row[];
  series: ChartSeries<Row>[];
  range: AnalyticsRange;
  formatValue: (value: number | null) => string;
  formatTick: (value: number) => string;
  /** For rates between 0 and 1, whose axis would otherwise round up to whole numbers. */
  fractional?: boolean;
}) {
  const axes = [
    <CartesianGrid key="grid" vertical={false} stroke="var(--chart-grid)" />,
    <XAxis
      key="x"
      dataKey="time"
      tickFormatter={(value) => formatBucket(String(value), range)}
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: "var(--line-strong)" }}
      minTickGap={48}
      interval="preserveStartEnd"
    />,
    <YAxis
      key="y"
      width={44}
      tick={axisTick}
      tickLine={false}
      axisLine={false}
      tickFormatter={formatTick}
      allowDecimals={fractional}
    />,
    <Tooltip
      key="tooltip"
      isAnimationActive={false}
      cursor={kind === "bar" ? { fill: "var(--hover)" } : { stroke: "var(--line-strong)" }}
      content={(props) => (
        <ChartTooltip
          active={props.active}
          payload={props.payload as readonly TooltipEntry[] | undefined}
          label={props.label}
          range={range}
          series={series}
          format={formatValue}
        />
      )}
    />,
  ];

  const margin = { top: 8, right: 8, bottom: 0, left: 0 };

  return (
    <figure aria-label={label} className="m-0" style={{ height: CHART_HEIGHT }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 480, height: CHART_HEIGHT }}
      >
        {kind === "bar" ? (
          <BarChart data={data} margin={margin} barCategoryGap="20%">
            {axes}
            {series.map((entry) => (
              <Bar
                key={entry.key}
                dataKey={entry.key as string}
                name={entry.label}
                fill={entry.color}
                radius={[2, 2, 0, 0]}
                maxBarSize={20}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={margin}>
            {axes}
            {series.map((entry) => (
              <Line
                key={entry.key}
                dataKey={entry.key}
                name={entry.label}
                type="linear"
                stroke={entry.color}
                strokeWidth={2}
                // Null means no data, and a lone bucket between nulls has no segment
                // to draw, so the dots are what keeps it visible.
                dot={{ r: 2, fill: entry.color, strokeWidth: 0 }}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}

/** Sits in the chart's place at the same height, so an empty panel does not resize. */
export function ChartMessage({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center justify-center px-6 text-center text-sm text-fg-3"
      style={{ height: CHART_HEIGHT }}
    >
      <p className="max-w-[40ch]">{children}</p>
    </div>
  );
}
