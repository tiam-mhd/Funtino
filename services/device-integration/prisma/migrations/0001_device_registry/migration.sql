CREATE SCHEMA IF NOT EXISTS "device_integration";

CREATE TYPE "device_integration"."device_type" AS ENUM ('rfid_reader', 'terminal', 'access_gate', 'other');
CREATE TYPE "device_integration"."device_status" AS ENUM ('active', 'suspended', 'retired');
CREATE TYPE "device_integration"."reported_health_state" AS ENUM ('online', 'degraded', 'offline');

CREATE TABLE "device_integration"."devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "adapter_key" VARCHAR(60) NOT NULL,
    "external_device_id" VARCHAR(160) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "device_type" "device_integration"."device_type" NOT NULL,
    "status" "device_integration"."device_status" NOT NULL DEFAULT 'active',
    "latest_reported_state" "device_integration"."reported_health_state",
    "latest_observed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_integration"."device_health_observations" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "external_observation_id" VARCHAR(160) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "reported_state" "device_integration"."reported_health_state" NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" UUID NOT NULL,
    "applied_as_latest" BOOLEAN NOT NULL,
    CONSTRAINT "device_health_observations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_integration"."device_transaction_imports" (
    "external_event_id" VARCHAR(160) NOT NULL,
    "transaction_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_transaction_imports_pkey" PRIMARY KEY ("external_event_id")
);

CREATE TABLE "device_integration"."device_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "caller_service" VARCHAR(80) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "device_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_integration"."idempotency_commands" (
    "caller_service" VARCHAR(80) NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_commands_pkey" PRIMARY KEY ("caller_service", "key")
);

CREATE TABLE "device_integration"."outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "envelope" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "dead_lettered_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "devices_org_adapter_external_id_key"
    ON "device_integration"."devices"("organization_id", "adapter_key", "external_device_id");
CREATE INDEX "devices_org_branch_id_idx"
    ON "device_integration"."devices"("organization_id", "branch_id", "id");
CREATE INDEX "devices_org_branch_status_id_idx"
    ON "device_integration"."devices"("organization_id", "branch_id", "status", "id");
CREATE UNIQUE INDEX "device_health_observations_device_external_id_key"
    ON "device_integration"."device_health_observations"("device_id", "external_observation_id");
CREATE INDEX "device_health_observations_device_observed_idx"
    ON "device_integration"."device_health_observations"("device_id", "observed_at", "id");
CREATE UNIQUE INDEX "device_transaction_imports_transaction_id_key"
    ON "device_integration"."device_transaction_imports"("transaction_id");
CREATE INDEX "device_transaction_imports_scope_received_idx"
    ON "device_integration"."device_transaction_imports"("organization_id", "branch_id", "received_at");
CREATE INDEX "device_audit_logs_device_created_idx"
    ON "device_integration"."device_audit_logs"("device_id", "created_at");
CREATE INDEX "device_audit_logs_scope_created_idx"
    ON "device_integration"."device_audit_logs"("organization_id", "branch_id", "created_at");
CREATE INDEX "device_audit_logs_actor_created_idx"
    ON "device_integration"."device_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "idempotency_commands_created_idx"
    ON "device_integration"."idempotency_commands"("created_at");
CREATE INDEX "outbox_events_delivery_idx"
    ON "device_integration"."outbox_events"("published_at", "dead_lettered_at", "available_at", "created_at");

ALTER TABLE "device_integration"."device_health_observations"
  ADD CONSTRAINT "device_health_observations_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "device_integration"."devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "device_integration"."prevent_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'device integration audit/observation/import records are append-only';
END;
$$;

CREATE TRIGGER "device_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "device_integration"."device_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "device_integration"."prevent_append_only_mutation"();
CREATE TRIGGER "device_audit_logs_no_truncate"
BEFORE TRUNCATE ON "device_integration"."device_audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "device_integration"."prevent_append_only_mutation"();
CREATE TRIGGER "device_health_observations_append_only"
BEFORE UPDATE OR DELETE ON "device_integration"."device_health_observations"
FOR EACH ROW EXECUTE FUNCTION "device_integration"."prevent_append_only_mutation"();
CREATE TRIGGER "device_health_observations_no_truncate"
BEFORE TRUNCATE ON "device_integration"."device_health_observations"
FOR EACH STATEMENT EXECUTE FUNCTION "device_integration"."prevent_append_only_mutation"();
CREATE TRIGGER "device_transaction_imports_append_only"
BEFORE UPDATE OR DELETE ON "device_integration"."device_transaction_imports"
FOR EACH ROW EXECUTE FUNCTION "device_integration"."prevent_append_only_mutation"();
CREATE TRIGGER "device_transaction_imports_no_truncate"
BEFORE TRUNCATE ON "device_integration"."device_transaction_imports"
FOR EACH STATEMENT EXECUTE FUNCTION "device_integration"."prevent_append_only_mutation"();
