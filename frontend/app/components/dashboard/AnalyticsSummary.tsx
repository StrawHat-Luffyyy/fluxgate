import { Activity, ShieldAlert, Zap } from "lucide-react";
import StatCard, { StatCardSkeleton } from "../ui/StatCard";

interface AnalyticsSummaryProps {
  data: {
    totalRequests: number;
    totalAnomalies: number;
    avgLatencyMs: number;
  };
}

export default function AnalyticsSummary({ data }: AnalyticsSummaryProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <StatCard
        icon={Activity}
        label="Total Requests (24h)"
        value={data.totalRequests.toLocaleString()}
        iconColorClass="bg-blue-500/20 text-blue-400"
      />
      <StatCard
        icon={ShieldAlert}
        label="Threats Blocked"
        value={data.totalAnomalies}
        iconColorClass="bg-red-500/20 text-red-400"
      />
      <StatCard
        icon={Zap}
        label="Avg Proxy Latency"
        value={`${data.avgLatencyMs} ms`}
        iconColorClass="bg-green-500/20 text-green-400"
      />
    </div>
  );
}

export function AnalyticsSummarySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
    </div>
  );
}
