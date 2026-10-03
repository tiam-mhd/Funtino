CREATE SCHEMA IF NOT EXISTS "customer_household";

CREATE TYPE "customer_household"."household_status" AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE "customer_household"."household_access_role" AS ENUM ('owner', 'guardian');
CREATE TYPE "customer_household"."household_access_status" AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE "customer_household"."household_member_status" AS ENUM ('active', 'archived');

CREATE TABLE "customer_household"."households" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "status" "customer_household"."household_status" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "households_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_household_version_positive_check" CHECK ("version" > 0),
    CONSTRAINT "customer_household_name_nonempty_check" CHECK (length(trim("name")) >= 2)
);

CREATE TABLE "customer_household"."household_accesses" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "customer_household"."household_access_role" NOT NULL DEFAULT 'owner',
    "status" "customer_household"."household_access_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "household_accesses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "household_accesses_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "customer_household"."households"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_household_owner_access_role_check" CHECK ("role" <> 'owner' OR "status" IN ('active', 'suspended', 'revoked'))
);

CREATE TABLE "customer_household"."household_members" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "relationship" VARCHAR(40) NOT NULL,
    "birth_date" DATE,
    "is_dependent" BOOLEAN NOT NULL DEFAULT true,
    "status" "customer_household"."household_member_status" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "customer_household"."households"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_household_member_version_positive_check" CHECK ("version" > 0),
    CONSTRAINT "customer_household_member_name_nonempty_check" CHECK (length(trim("display_name")) >= 2)
);

CREATE TABLE "customer_household"."audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "caller_service" VARCHAR(80) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "resource_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_household"."idempotency_commands" (
    "caller_service" VARCHAR(80) NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_commands_pkey" PRIMARY KEY ("caller_service", "key")
);

CREATE TABLE "customer_household"."outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "aggregate_id" VARCHAR(80) NOT NULL,
    "envelope" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "dead_lettered_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_household_outbox_attempts_nonnegative_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "customer_household_access_household_user_key" ON "customer_household"."household_accesses"("household_id", "user_id");
CREATE INDEX "customer_household_owner_status_idx" ON "customer_household"."households"("owner_user_id", "status", "created_at");
CREATE INDEX "customer_household_access_user_status_idx" ON "customer_household"."household_accesses"("user_id", "status", "household_id");
CREATE INDEX "customer_household_member_household_status_idx" ON "customer_household"."household_members"("household_id", "status", "created_at");
CREATE INDEX "customer_household_audit_actor_created_idx" ON "customer_household"."audit_logs"("actor_user_id", "created_at", "id");
CREATE INDEX "customer_household_audit_resource_created_idx" ON "customer_household"."audit_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "customer_household_audit_correlation_idx" ON "customer_household"."audit_logs"("correlation_id");
CREATE INDEX "customer_household_idempotency_created_idx" ON "customer_household"."idempotency_commands"("created_at");
CREATE INDEX "customer_household_outbox_delivery_idx" ON "customer_household"."outbox_events"("published_at", "dead_lettered_at", "available_at", "created_at");
