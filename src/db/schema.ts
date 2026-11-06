import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"), // 'free', 'pro', 'enterprise'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Foreign key linking the key to the tenant. Cascade delete ensures if
  // the tenant is deleted, all their keys are wiped automatically.
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull().default("Default"),
  keyHash: text("key_hash").notNull().unique(),
  hint: text("hint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const gatewayRoutes = pgTable(
  "gateway_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    pathPrefix: text("path_prefix").notNull(),
    targetUrl: text("target_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tenant_path_idx").on(table.tenantId, table.pathPrefix),
  ],
);

export const roleEnum = pgEnum("role", ["admin", "viewer"]);
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  role: roleEnum("role").notNull().default("viewer"),
});

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    // AES-256-GCM ciphertext: see lib/secretBox.ts.
    encryptedSecret: text("encrypted_secret").notNull(),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).defaultNow(), // null means disabled
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("webhook_endpoints_tenant_idx").on(table.tenantId)],
);

export const deliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "dead",
]);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    endpointId: uuid("endpoint_id")
      .references(() => webhookEndpoints.id, { onDelete: "cascade" })
      .notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("webhook_deliveries_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("webhook_deliveries_status_updated_idx").on(table.status, table.updatedAt),
  ],
);

export const rateLimitStrategyEnum = pgEnum("rate_limit_strategy", [
  "token_bucket",
  "leaky_bucket",
  "sliding_window",
]);

export const rateLimitConfigs = pgTable("rate_limit_configs", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  strategy: rateLimitStrategyEnum("strategy").notNull(),
  capacity: integer("capacity").notNull(),
  refillRate: doublePrecision("refill_rate").notNull(),
  windowMs: integer("window_ms").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per authenticated gateway request. Kept for RETENTION_DAYS, see
// telemetry/requestLogWriter.ts.
export const requestLogs = pgTable(
  "request_logs",
  {
    requestId: uuid("request_id").primaryKey(),
    // No foreign key, on purpose. Rows are inserted in batches, so one buffered row
    // for a just-deleted tenant would fail the batch and lose other tenants' rows.
    // Orphans age out through retention.
    tenantId: uuid("tenant_id").notNull(),
    apiKeyId: uuid("api_key_id").notNull(),
    method: text("method").notNull(),
    routePrefix: text("route_prefix").notNull(),
    statusCode: integer("status_code").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    requestBytes: bigint("request_bytes", { mode: "number" }).notNull(),
    responseBytes: bigint("response_bytes", { mode: "number" }).notNull(),
    rateLimited: boolean("rate_limited").notNull(),
    upstreamCalled: boolean("upstream_called").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("request_logs_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("request_logs_created_idx").on(table.createdAt),
  ],
);

export const anomalyStatusEnum = pgEnum("anomaly_status", [
  "open",
  "acknowledged",
  "resolved",
]);

export const anomalies = pgTable(
  "anomalies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    requestId: text("request_id").notNull(),
    status: anomalyStatusEnum("status").notNull().default("open"),
    detector: text("detector").notNull(),
    score: doublePrecision("score").notNull(),
    modelVersion: text("model_version").notNull(),
    topFeature: text("top_feature").notNull(),
    topFeatureValue: doublePrecision("top_feature_value").notNull(),
    attribution: jsonb("attribution").notNull(),
    features: jsonb("features").notNull(),
    message: text("message").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Kafka delivery is at-least-once: this is what makes alerts idempotent.
    uniqueIndex("anomalies_tenant_request_idx").on(table.tenantId, table.requestId),
    index("anomalies_tenant_detected_idx").on(table.tenantId, table.detectedAt),
  ],
);
