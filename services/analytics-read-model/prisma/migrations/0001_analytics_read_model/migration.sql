CREATE SCHEMA IF NOT EXISTS "analytics_read_model";

CREATE TYPE "analytics_read_model"."resource_status" AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE "analytics_read_model"."device_lifecycle_status" AS ENUM ('active', 'suspended', 'retired');
CREATE TYPE "analytics_read_model"."device_health_state" AS ENUM ('online', 'degraded', 'offline');
CREATE TYPE "analytics_read_model"."projection_generation_status" AS ENUM ('building', 'active', 'superseded', 'failed');

CREATE TABLE "analytics_read_model"."projection_generations" (
    "id" UUID NOT NULL,
    "status" "analytics_read_model"."projection_generation_status" NOT NULL DEFAULT 'building',
    "high_watermark" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    CONSTRAINT "projection_generations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_read_model"."projection_control" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active_generation_id" UUID,
    "coverage_started_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),
    "last_processed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "projection_control_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projection_control_singleton_id_check" CHECK ("id" = 1)
);

CREATE TABLE "analytics_read_model"."rebuild_lease" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lease_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    CONSTRAINT "rebuild_lease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rebuild_lease_singleton_id_check" CHECK ("id" = 1)
);

CREATE TABLE "analytics_read_model"."analytics_events" (
    "sequence" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "source_id" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(160) NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("sequence")
);

CREATE TABLE "analytics_read_model"."organization_projection" (
    "generation_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT,
    "status" "analytics_read_model"."resource_status" NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "organization_projection_pkey" PRIMARY KEY ("generation_id", "id")
);

CREATE TABLE "analytics_read_model"."branch_projection" (
    "generation_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT,
    "status" "analytics_read_model"."resource_status" NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "branch_projection_pkey" PRIMARY KEY ("generation_id", "id")
);

CREATE TABLE "analytics_read_model"."device_projection" (
    "generation_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "displayName" TEXT,
    "device_type" VARCHAR(40),
    "status" "analytics_read_model"."device_lifecycle_status",
    "latest_health" "analytics_read_model"."device_health_state",
    "latest_observed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "device_projection_pkey" PRIMARY KEY ("generation_id", "id")
);

CREATE TABLE "analytics_read_model"."daily_operational_metrics" (
    "generation_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "metric_key" VARCHAR(80) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "daily_operational_metrics_pkey" PRIMARY KEY ("generation_id", "day", "organization_id", "branch_id", "metric_key"),
    CONSTRAINT "daily_operational_metrics_count_nonnegative_check" CHECK ("count" >= 0)
);

CREATE TABLE "analytics_read_model"."report_export_audit" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "from_day" DATE NOT NULL,
    "to_day" DATE NOT NULL,
    "row_count" INTEGER NOT NULL,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_export_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_export_audit_valid_range_check" CHECK ("to_day" >= "from_day"),
    CONSTRAINT "report_export_audit_row_count_check" CHECK ("row_count" BETWEEN 1 AND 366)
);

CREATE INDEX "projection_generations_status_created_at_idx" ON "analytics_read_model"."projection_generations"("status", "created_at");
CREATE UNIQUE INDEX "analytics_events_event_id_key" ON "analytics_read_model"."analytics_events"("event_id");
CREATE INDEX "analytics_events_scope_time_idx" ON "analytics_read_model"."analytics_events"("organization_id", "branch_id", "occurred_at", "event_type");
CREATE INDEX "organization_projection_generation_id_status_idx" ON "analytics_read_model"."organization_projection"("generation_id", "status");
CREATE INDEX "branch_projection_scope_idx" ON "analytics_read_model"."branch_projection"("generation_id", "organization_id", "status", "id");
CREATE INDEX "device_projection_scope_idx" ON "analytics_read_model"."device_projection"("generation_id", "organization_id", "branch_id", "status");
CREATE INDEX "device_projection_generation_id_latest_observed_at_idx" ON "analytics_read_model"."device_projection"("generation_id", "latest_observed_at");
CREATE INDEX "daily_metrics_scope_day_idx" ON "analytics_read_model"."daily_operational_metrics"("generation_id", "organization_id", "day", "metric_key");
CREATE INDEX "report_export_audit_scope_created_idx" ON "analytics_read_model"."report_export_audit"("organization_id", "branch_id", "created_at");
CREATE INDEX "report_export_audit_actor_created_idx" ON "analytics_read_model"."report_export_audit"("actor_user_id", "created_at");

CREATE FUNCTION "analytics_read_model"."reject_immutable_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable analytics journal rows cannot be changed';
END;
$$;

CREATE TRIGGER "analytics_events_append_only"
BEFORE UPDATE OR DELETE ON "analytics_read_model"."analytics_events"
FOR EACH ROW EXECUTE FUNCTION "analytics_read_model"."reject_immutable_mutation"();

CREATE TRIGGER "report_export_audit_append_only"
BEFORE UPDATE OR DELETE ON "analytics_read_model"."report_export_audit"
FOR EACH ROW EXECUTE FUNCTION "analytics_read_model"."reject_immutable_mutation"();
