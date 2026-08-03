import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("analytics-service");

export interface AnalyticsOverview {
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
}

export async function getAnalyticsOverview(_tenantId: string): Promise<AnalyticsOverview> {
  const now = new Date();
  const timeSeries: AnalyticsOverview["timeSeries"] = [];
  let totalRequests = 0;
  let totalAnomalies = 0;

  for (let i = 24; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);

    const baseTraffic = Math.floor(Math.abs(Math.sin(i / 3)) * 5000) + 500;

    const isAnomaly = Math.random() > 0.9;
    const anomalies = isAnomaly ? Math.floor(Math.random() * 5) + 1 : 0;

    totalRequests += baseTraffic;
    totalAnomalies += anomalies;

    timeSeries.push({
      time: `${timestamp.getHours()}:00`,
      requests: baseTraffic,
      anomalies: anomalies,
    });
  }

  log.debug({ tenantId: _tenantId, totalRequests }, "Analytics overview generated");

  return {
    summary: {
      totalRequests,
      totalAnomalies,
      avgLatencyMs: 42, // Mocked
    },
    timeSeries,
  };
}
