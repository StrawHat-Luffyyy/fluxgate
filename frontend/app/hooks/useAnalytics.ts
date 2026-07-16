"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export type AnalyticsData = {
  summary: {
    totalRequests: number;
    totalAnomalies: number;
    avgLatencyMs: number;
  };
  timeSeries: {
    time: string;
    requests: number;
    anomalies: number;
  }[];
};

interface AnalyticsResponse extends AnalyticsData {
  success: boolean;
}

export function useAnalytics() {
  const query = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => apiFetch<AnalyticsResponse>("/analytics/overview"),
    refetchInterval: 60_000, // Auto-refetch every 60 seconds
  });

  return {
    data: query.data
      ? {
          summary: query.data.summary,
          timeSeries: query.data.timeSeries,
        }
      : null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
