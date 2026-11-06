import type { AnalyticsRange } from "./types";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

export const formatCount = (value: number) => whole.format(value);
export const formatCompact = (value: number) => compact.format(value);

export const formatPercent = (fraction: number | null) => {
  if (fraction === null) return "—";
  const percent = fraction * 100;
  if (percent === 0) return "0%";
  if (percent < 0.01) return "<0.01%";
  return `${percent.toFixed(percent < 10 ? 2 : 1)}%`;
};

/** Null means no upstream was called in the window, which is not a latency of zero. */
export const formatLatency = (ms: number | null) => {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const formatRelative = (iso: string) => {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), "day");
  return formatDate(iso);
};

export const formatBucket = (iso: string, range: AnalyticsRange) => {
  const date = new Date(iso);
  if (range === "7d") {
    return date.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

export const RANGE_LABEL: Record<AnalyticsRange, string> = {
  "1h": "last hour",
  "24h": "last 24 hours",
  "7d": "last 7 days",
};

export const BUCKET_LABEL: Record<AnalyticsRange, string> = {
  "1h": "per minute",
  "24h": "per hour",
  "7d": "per 6 hours",
};
