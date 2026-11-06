"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { toast } from "sonner";
import { useState } from "react";

export type ApiKey = {
  id: string;
  tenant_id: string;
  key_hash: string;
  hint: string;
  created_at: string;
  expires_at: string | null;
};

interface KeysResponse {
  success: boolean;
  message: string;
  keys: ApiKey[];
}

interface GenerateKeyResponse {
  apiKey: string;
  message: string;
}

export function useApiKeys() {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => apiFetch<KeysResponse>("/keys"),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch<GenerateKeyResponse>("/keys", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data) => {
      setNewKey(data.apiKey);
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      toast.success("API key generated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to generate key");
    },
  });

  return {
    keys: keysQuery.data?.keys ?? [],
    isLoading: keysQuery.isLoading,
    error: keysQuery.error,
    newKey,
    generateKey: () => generateMutation.mutate(),
    isGenerating: generateMutation.isPending,
  };
}
