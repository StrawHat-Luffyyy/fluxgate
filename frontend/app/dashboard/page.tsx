"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ApiKey = {
  id: string;
  tenant_id: string;
  key_hash: string;
  hint: string;
  created_at: string;
  expires_at: string | null;
};

export default function DashboardPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
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
  useEffect(() => {
    (async () => {
      await fetchKeys();
    })();
  }, [router]);

  const generateKey = async () => {
    try {
      const res = await fetch("http://localhost:3000/api/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: "replace-with-real-tenant-id" }), // Update based on your DB!
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
    <div className="min-h-screen bg-gray-900 text-white p-10">
      <h1 className="text-3xl font-bold mb-6">FluxGate Dashboard</h1>

      {error && <div className="bg-red-500 p-3 rounded mb-4">{error}</div>}

      <button
        onClick={generateKey}
        className="bg-green-600 hover:bg-green-500 p-2 rounded font-bold mb-6"
      >
        + Generate New API Key
      </button>

      {newKey && (
        <div className="bg-yellow-600 text-black p-4 rounded mb-6 font-mono text-sm">
          <p className="font-bold">
            Save this key, it will not be shown again!
          </p>
          <p>{newKey}</p>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl mb-4">Active Keys</h2>
        <ul className="space-y-2">
          {keys.map((key, i) => (
            <li
              key={i}
              className="flex justify-between bg-gray-700 p-3 rounded font-mono text-sm"
            >
              <span>{key.hint}</span>
              <span className="text-gray-400">
                Created: {new Date(key.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
          {keys.length === 0 && (
            <p className="text-gray-400">No API keys found.</p>
          )}
        </ul>
      </div>
    </div>
  );
}
