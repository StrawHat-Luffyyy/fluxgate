// The gateway's response shapes, from src/routes and src/services. Timestamps cross
// the wire as ISO strings.

export type Role = "admin" | "viewer";

export interface Me {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
  tenantName: string;
  plan: string;
}

export type AnalyticsRange = "1h" | "24h" | "7d";

export interface OverviewBucket {
  time: string;
  requests: number;
  errors: number;
  rateLimited: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  anomalies: number;
}

export interface AnalyticsOverview {
  success: boolean;
  range: AnalyticsRange;
  summary: {
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    rateLimitedCount: number;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    totalAnomalies: number;
    openAnomalies: number;
  };
  timeSeries: OverviewBucket[];
  topRoutes: {
    routePrefix: string;
    requests: number;
    errors: number;
    p95LatencyMs: number | null;
  }[];
  topConsumers: {
    apiKeyId: string;
    name: string;
    hint: string;
    requests: number;
    rateLimited: number;
  }[];
}

export interface GatewayRoute {
  id: string;
  tenantId: string;
  pathPrefix: string;
  targetUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type RateLimitStrategy = "token_bucket" | "leaky_bucket" | "sliding_window";

export interface RateLimitConfig {
  strategy: RateLimitStrategy;
  capacity: number;
  refillRate: number;
  windowMs: number;
}

export type AnomalyStatus = "open" | "acknowledged" | "resolved";

export interface Anomaly {
  id: string;
  tenantId: string;
  requestId: string;
  status: AnomalyStatus;
  detector: string;
  score: number;
  modelVersion: string;
  topFeature: string;
  topFeatureValue: number;
  attribution: Record<string, number>;
  features: Record<string, number>;
  message: string;
  detectedAt: string;
  updatedAt: string;
}

export interface AnomalyPage {
  anomalies: Anomaly[];
  nextCursor: string | null;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  enabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryStatus = "pending" | "delivered" | "dead";

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface TeamMember {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Readiness {
  status: "ok" | "degraded" | "unavailable";
  draining: boolean;
  checks: { postgres: "up" | "down"; redis: "up" | "down"; kafka: "up" | "down" };
  telemetryBuffered: number;
}
