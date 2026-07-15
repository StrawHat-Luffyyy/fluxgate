"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Activity, ShieldAlert, Zap } from "lucide-react";

type ApiKey = {
  id: string;
  tenant_id: string;
  key_hash: string;
  hint: string;
  created_at: string;
  expires_at: string | null;
};

type AnalyticsData = {
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

export default function DashboardPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  const fetchKeys = async () => {
    try {
      const res = await fetch("http://localhost:3000/api/keys", {
        credentials: "include",
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (err) {
      console.error("Failed to fetch keys", err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      // Ensure this matches the endpoint you mounted in your backend app.ts
      const res = await fetch("http://localhost:3000/analytics/overview", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (err) {
      console.error("Failed to fetch analytics", err);
    }
  };

  useEffect(() => {
    (async () => {
      await fetchKeys();
      await fetchAnalytics();
    })();
  }, [router]);

  const generateKey = async () => {
    try {
      const res = await fetch("http://localhost:3000/api/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setNewKey(data.apiKey);
        fetchKeys();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to generate key");
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-white p-8 font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-tight">
        Traffic Intelligence
      </h1>

      {error && <div className="bg-red-500 p-3 rounded mb-4">{error}</div>}

      {/* --- NEW: ANALYTICS SUMMARY CARDS --- */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 text-blue-400 rounded-lg">
              <Activity size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm">Total Requests (24h)</p>
              <p className="text-2xl font-bold">
                {analytics.summary.totalRequests.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 flex items-center gap-4">
            <div className="p-3 bg-red-500/20 text-red-400 rounded-lg">
              <ShieldAlert size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm">Threats Blocked</p>
              <p className="text-2xl font-bold">
                {analytics.summary.totalAnomalies}
              </p>
            </div>
          </div>
          <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 flex items-center gap-4">
            <div className="p-3 bg-green-500/20 text-green-400 rounded-lg">
              <Zap size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm">Avg Proxy Latency</p>
              <p className="text-2xl font-bold">
                {analytics.summary.avgLatencyMs} ms
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- NEW: RECHARTS TIME-SERIES GRAPH --- */}
      {analytics && (
        <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 mb-8 h-96">
          <h2 className="text-lg font-semibold mb-6 text-gray-300">
            Request Volume & Anomalies
          </h2>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={analytics.timeSeries}
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
      )}

      {/* --- EXISTING API KEYS SECTION --- */}
      <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-gray-300">
            API Credentials
          </h2>
          <button
            onClick={generateKey}
            className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded font-bold transition text-sm"
          >
            + Generate New API Key
          </button>
        </div>

        {newKey && (
          <div className="bg-yellow-600/20 border border-yellow-600 text-yellow-500 p-4 rounded mb-6 font-mono text-sm">
            <p className="font-bold mb-1">
              Save this key, it will not be shown again!
            </p>
            <p>{newKey}</p>
          </div>
        )}

        <ul className="space-y-3">
          {keys.map((key, i) => (
            <li
              key={i}
              className="flex justify-between items-center bg-gray-900/50 border border-gray-700 p-4 rounded font-mono text-sm"
            >
              <span className="text-gray-200">{key.hint}</span>
              <span className="text-gray-500">
                Created: {new Date(key.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
          {keys.length === 0 && (
            <p className="text-gray-500 italic py-4">No API keys found.</p>
          )}
        </ul>
      </div>
    </div>
  );
}
