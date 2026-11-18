CREATE TYPE "device_integration"."edge_installation_status" AS ENUM ('active', 'suspended', 'revoked');

CREATE TABLE "device_integration"."edge_installations" (
  "source_instance_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "current_key_id" VARCHAR(120) NOT NULL,
  "previous_key_id" VARCHAR(120),
  "status" "device_integration"."edge_installation_status" NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "last_heartbeat_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_installations_pkey" PRIMARY KEY ("source_instance_id")
);
CREATE UNIQUE INDEX "edge_installations_scope_instance_key"
  ON "device_integration"."edge_installations"("organization_id", "branch_id", "source_instance_id");
CREATE INDEX "edge_installations_scope_status_idx"
  ON "device_integration"."edge_installations"("organization_id", "branch_id", "status");

CREATE TABLE "device_integration"."edge_transaction_imports" (
  "event_id" UUID NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "local_transaction_id" VARCHAR(160) NOT NULL,
  "local_sequence" BIGINT NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "event_payload" JSONB NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_transaction_imports_pkey" PRIMARY KEY ("event_id")
);
CREATE UNIQUE INDEX "edge_transaction_imports_instance_local_key"
  ON "device_integration"."edge_transaction_imports"("source_instance_id", "local_transaction_id");
CREATE UNIQUE INDEX "edge_transaction_imports_instance_sequence_key"
  ON "device_integration"."edge_transaction_imports"("source_instance_id", "local_sequence");
CREATE INDEX "edge_transaction_imports_scope_received_idx"
  ON "device_integration"."edge_transaction_imports"("organization_id", "branch_id", "received_at");

CREATE TABLE "device_integration"."edge_rate_limits" (
  "source_instance_id" UUID NOT NULL,
  "window_started_at" TIMESTAMPTZ(0) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("source_instance_id", "window_started_at"),
  CONSTRAINT "edge_rate_limits_count_nonnegative_check" CHECK ("request_count" >= 0)
);

CREATE TABLE "device_integration"."edge_installation_audit" (
  "id" UUID NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "caller_service" VARCHAR(80) NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "before" JSONB,
  "after" JSONB NOT NULL,
  CONSTRAINT "edge_installation_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "edge_installation_audit_instance_created_idx"
  ON "device_integration"."edge_installation_audit"("source_instance_id", "created_at");
CREATE INDEX "edge_installation_audit_scope_created_idx"
  ON "device_integration"."edge_installation_audit"("organization_id", "branch_id", "created_at");
