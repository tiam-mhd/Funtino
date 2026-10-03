-- Schema creation is separated in prisma/bootstrap.sql so runtime and migration
-- credentials can be provisioned independently.
CREATE TYPE "organization_branch"."resource_status" AS ENUM ('active', 'suspended', 'archived');

CREATE TABLE "organization_branch"."organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
    "status" "organization_branch"."resource_status" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "legacy_created_at_local" VARCHAR(32),
    "legacy_updated_at_local" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_branch"."branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
    "status" "organization_branch"."resource_status" NOT NULL DEFAULT 'active',
    "opening_hours" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "legacy_created_at_local" VARCHAR(32),
    "legacy_updated_at_local" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_branch"."audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "caller_service" VARCHAR(80) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "resource_id" UUID NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "correlation_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_branch"."idempotency_commands" (
    "caller_service" VARCHAR(80) NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_commands_pkey" PRIMARY KEY ("caller_service", "key")
);

CREATE TABLE "organization_branch"."outbox_events" (
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

CREATE TABLE "organization_branch"."backfill_runs" (
    "id" UUID NOT NULL,
    "source_system" VARCHAR(80) NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "organizations" INTEGER NOT NULL DEFAULT 0,
    "branches" INTEGER NOT NULL DEFAULT 0,
    "inserted_organizations" INTEGER NOT NULL DEFAULT 0,
    "inserted_branches" INTEGER NOT NULL DEFAULT 0,
    "conflict_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "summary" JSONB,
    CONSTRAINT "backfill_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organization_branch"."organizations"("slug");
CREATE INDEX "organizations_status_name_idx" ON "organization_branch"."organizations"("status", "name");
CREATE UNIQUE INDEX "branches_organization_id_slug_key" ON "organization_branch"."branches"("organization_id", "slug");
CREATE INDEX "branches_organization_id_id_idx" ON "organization_branch"."branches"("organization_id", "id");
CREATE INDEX "branches_organization_id_status_name_idx" ON "organization_branch"."branches"("organization_id", "status", "name");
CREATE INDEX "branches_status_id_idx" ON "organization_branch"."branches"("status", "id");
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "organization_branch"."audit_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_logs_organization_id_branch_id_created_at_idx" ON "organization_branch"."audit_logs"("organization_id", "branch_id", "created_at");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "organization_branch"."audit_logs"("actor_user_id", "created_at");
CREATE INDEX "idempotency_commands_created_at_idx" ON "organization_branch"."idempotency_commands"("created_at");
CREATE INDEX "outbox_events_published_at_dead_lettered_at_available_at_cr_idx" ON "organization_branch"."outbox_events"("published_at", "dead_lettered_at", "available_at", "created_at");
CREATE UNIQUE INDEX "backfill_runs_source_system_source_hash_key" ON "organization_branch"."backfill_runs"("source_system", "source_hash");

ALTER TABLE "organization_branch"."branches"
  ADD CONSTRAINT "branches_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization_branch"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "organization_branch"."prevent_audit_log_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'organization_branch.audit_logs is append-only';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "organization_branch"."audit_logs"
FOR EACH ROW EXECUTE FUNCTION "organization_branch"."prevent_audit_log_mutation"();

CREATE TRIGGER "audit_logs_no_truncate"
BEFORE TRUNCATE ON "organization_branch"."audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "organization_branch"."prevent_audit_log_mutation"();
