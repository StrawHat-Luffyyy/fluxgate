"use client";

import { useApiKeys } from "../hooks/useApiKeys";
import { useAnalytics } from "../hooks/useAnalytics";
import AnalyticsSummary, {
  AnalyticsSummarySkeleton,
} from "../components/dashboard/AnalyticsSummary";
import TrafficChart, {
  TrafficChartSkeleton,
} from "../components/charts/TrafficChart";
import ApiKeysPanel from "../components/dashboard/ApiKeysPanel";

export default function DashboardPage() {
  const { keys, isLoading: keysLoading, newKey, generateKey, isGenerating } =
    useApiKeys();
  const { data: analytics, isLoading: analyticsLoading } = useAnalytics();

  return (
    <div className="min-h-screen bg-[#0f1115] text-white p-4 sm:p-8 font-sans">
      <h1 className="text-2xl sm:text-3xl font-bold mb-8 tracking-tight">
        Traffic Intelligence
      </h1>

      {/* Analytics Summary Cards */}
      {analyticsLoading ? (
        <AnalyticsSummarySkeleton />
      ) : analytics ? (
        <AnalyticsSummary data={analytics.summary} />
      ) : null}

      {/* Time-Series Chart */}
      {analyticsLoading ? (
        <TrafficChartSkeleton />
      ) : analytics ? (
        <TrafficChart data={analytics.timeSeries} />
      ) : null}

      {/* API Keys Section */}
      <ApiKeysPanel
        keys={keys}
        isLoading={keysLoading}
        newKey={newKey}
        onGenerate={generateKey}
        isGenerating={isGenerating}
      />
    </div>
  );
}
