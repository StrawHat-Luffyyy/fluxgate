"use client";

import { toast } from "sonner";
import Skeleton from "../ui/Skeleton";
import type { ApiKey } from "../../hooks/useApiKeys";

interface ApiKeysPanelProps {
  keys: ApiKey[];
  isLoading: boolean;
  newKey: string | null;
  onGenerate: () => void;
  isGenerating: boolean;
}

export default function ApiKeysPanel({
  keys,
  isLoading,
  newKey,
  onGenerate,
  isGenerating,
}: ApiKeysPanelProps) {
  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied to clipboard");
  };

  return (
    <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h2 className="text-lg font-semibold text-gray-300">
          API Credentials
        </h2>
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:cursor-not-allowed px-4 py-2 rounded font-bold transition text-sm whitespace-nowrap"
        >
          {isGenerating ? "Generating..." : "+ Generate New API Key"}
        </button>
      </div>

      {newKey && (
        <div
          onClick={() => copyToClipboard(newKey)}
          className="bg-yellow-600/20 border border-yellow-600 text-yellow-500 p-4 rounded mb-6 font-mono text-sm cursor-pointer hover:bg-yellow-600/30 transition"
        >
          <p className="font-bold mb-1">
            Save this key, it will not be shown again! (Click to copy)
          </p>
          <p className="break-all">{newKey}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <ul className="space-y-3">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-900/50 border border-gray-700 p-4 rounded font-mono text-sm gap-2"
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
      )}
    </div>
  );
}
