"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Skeleton from "../ui/Skeleton";

interface TrafficChartProps {
  data: {
    time: string;
    requests: number;
    anomalies: number;
  }[];
}

export default function TrafficChart({ data }: TrafficChartProps) {
  return (
    <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 mb-8 h-96">
      <h2 className="text-lg font-semibold mb-6 text-gray-300">
        Request Volume & Anomalies
      </h2>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            stroke="#4b5563"
            fontSize={12}
            tickMargin={10}
          />
          <YAxis
            stroke="#4b5563"
            fontSize={12}
            tickFormatter={(value) => `${value / 1000}k`}
          />
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1f2937"
            vertical={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              borderColor: "#374151",
              borderRadius: "8px",
            }}
            itemStyle={{ color: "#e5e7eb" }}
          />
          <Area
            type="monotone"
            dataKey="requests"
            stroke="#3b82f6"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorRequests)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrafficChartSkeleton() {
  return (
    <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 mb-8 h-96">
      <Skeleton className="h-5 w-52 mb-6" />
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  );
}
