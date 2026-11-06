"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, API_BASE_URL, ApiError } from "./api";
import type {
  AnalyticsOverview,
  AnalyticsRange,
  ApiKey,
  GatewayRoute,
  Me,
  RateLimitConfig,
  Readiness,
  TeamMember,
  WebhookDelivery,
  WebhookEndpoint,
} from "./types";

export const queryKeys = {
  me: ["me"] as const,
  overview: (range: AnalyticsRange) => ["overview", range] as const,
  routes: ["routes"] as const,
  keys: ["keys"] as const,
  rateLimit: ["rate-limit"] as const,
  anomalies: ["anomalies"] as const,
  openAnomaly: ["anomalies", "open-indicator"] as const,
  endpoints: ["webhooks", "endpoints"] as const,
  deliveries: ["webhooks", "deliveries"] as const,
  team: ["team"] as const,
  health: ["health"] as const,
};

export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api<{ user: Me }>("/auth/me", { signal }).then((r) => r.user),
    staleTime: 30_000,
  });

/**
 * The gateway enforces roles. This only decides what to offer. It is false until
 * /auth/me answers, so a viewer never sees an action flash in and disappear.
 */
export const useCanEdit = () => useMe().data?.role === "admin";

export const useOverview = (range: AnalyticsRange) =>
  useQuery({
    queryKey: queryKeys.overview(range),
    queryFn: ({ signal }) =>
      api<AnalyticsOverview>(`/analytics/overview?range=${range}`, { signal }),
    // The gateway caches this for 10 seconds, so polling faster would not show more.
    refetchInterval: 15_000,
    // Switching range keeps the old charts on screen rather than collapsing to skeletons.
    placeholderData: keepPreviousData,
  });

export const useRoutes = () =>
  useQuery({
    queryKey: queryKeys.routes,
    queryFn: ({ signal }) =>
      api<{ routes: GatewayRoute[] }>("/admin/routes", { signal }).then((r) => r.routes),
  });

export const useKeys = () =>
  useQuery({
    queryKey: queryKeys.keys,
    queryFn: ({ signal }) => api<{ keys: ApiKey[] }>("/keys", { signal }).then((r) => r.keys),
  });

export const useRateLimit = () =>
  useQuery({
    queryKey: queryKeys.rateLimit,
    queryFn: ({ signal }) =>
      api<{ config: RateLimitConfig }>("/admin/rate-limit", { signal }).then((r) => r.config),
  });

export const useEndpoints = () =>
  useQuery({
    queryKey: queryKeys.endpoints,
    queryFn: ({ signal }) =>
      api<{ endpoints: WebhookEndpoint[] }>("/webhooks", { signal }).then((r) => r.endpoints),
  });

export const useDeliveries = () =>
  useQuery({
    queryKey: queryKeys.deliveries,
    queryFn: ({ signal }) =>
      api<{ deliveries: WebhookDelivery[] }>("/webhooks/deliveries", { signal }).then(
        (r) => r.deliveries,
      ),
    // Deliveries change on the worker's schedule: watch closely while any is in flight.
    refetchInterval: (query) =>
      query.state.data?.some((delivery) => delivery.status === "pending") ? 2_000 : 15_000,
  });

export const useTeam = () =>
  useQuery({
    queryKey: queryKeys.team,
    queryFn: ({ signal }) =>
      api<{ members: TeamMember[] }>("/team", { signal }).then((r) => r.members),
  });

/** Only used for the indicator in the navigation: is at least one anomaly open? */
export const useHasOpenAnomaly = () =>
  useQuery({
    queryKey: queryKeys.openAnomaly,
    queryFn: ({ signal }) =>
      api<{ anomalies: unknown[] }>("/anomalies?status=open&limit=1", { signal }).then(
        (r) => r.anomalies.length > 0,
      ),
    refetchInterval: 30_000,
  });

/** /health/ready answers 503 with the same body when not ready, so that is data too. */
export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: async ({ signal }) => {
      try {
        const res = await fetch(`${API_BASE_URL}/health/ready`, { signal });
        return (await res.json()) as Readiness;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        throw new ApiError("Unreachable", 0, "NETWORK_ERROR");
      }
    },
    refetchInterval: 30_000,
    retry: false,
  });
