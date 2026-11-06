CREATE TYPE "public"."anomaly_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_strategy" AS ENUM('token_bucket', 'leaky_bucket', 'sliding_window');--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"status" "anomaly_status" DEFAULT 'open' NOT NULL,
	"detector" text NOT NULL,
	"score" double precision NOT NULL,
	"model_version" text NOT NULL,
	"top_feature" text NOT NULL,
	"top_feature_value" double precision NOT NULL,
	"attribution" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"message" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_configs" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"strategy" "rate_limit_strategy" NOT NULL,
	"capacity" integer NOT NULL,
	"refill_rate" double precision NOT NULL,
	"window_ms" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"method" text NOT NULL,
	"route_prefix" text NOT NULL,
	"status_code" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"request_bytes" bigint NOT NULL,
	"response_bytes" bigint NOT NULL,
	"rate_limited" boolean NOT NULL,
	"upstream_called" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_configs" ADD CONSTRAINT "rate_limit_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anomalies_tenant_request_idx" ON "anomalies" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "anomalies_tenant_detected_idx" ON "anomalies" USING btree ("tenant_id","detected_at");--> statement-breakpoint
CREATE INDEX "request_logs_tenant_created_idx" ON "request_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "request_logs_created_idx" ON "request_logs" USING btree ("created_at");