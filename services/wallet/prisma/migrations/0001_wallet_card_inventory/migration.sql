CREATE SCHEMA IF NOT EXISTS "wallet";

CREATE TYPE "wallet"."card_inventory_status" AS ENUM ('in_stock', 'blocked', 'retired');
CREATE TYPE "wallet"."card_verification_status" AS ENUM ('unknown', 'verified', 'rejected');
CREATE TYPE "wallet"."card_inventory_action" AS ENUM ('registered', 'status_changed');

CREATE TABLE "wallet"."card_inventory" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "external_card_id" VARCHAR(160) NOT NULL,
    "status" "wallet"."card_inventory_status" NOT NULL DEFAULT 'in_stock',
    "verification_status" "wallet"."card_verification_status" NOT NULL DEFAULT 'unknown',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "card_inventory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_card_inventory_version_positive_check" CHECK ("version" > 0)
);

CREATE TABLE "wallet"."card_inventory_history" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "action" "wallet"."card_inventory_action" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "caller_service" VARCHAR(80) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_inventory_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_card_history_reason_nonempty_check" CHECK (length(trim("reason")) > 0),
    CONSTRAINT "card_inventory_history_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "wallet"."idempotency_commands" (
    "caller_service" VARCHAR(80) NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_commands_pkey" PRIMARY KEY ("caller_service", "key")
);

CREATE TABLE "wallet"."outbox_events" (
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

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_outbox_attempts_nonnegative_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "wallet_card_inventory_external_id_key" ON "wallet"."card_inventory"("external_card_id");
CREATE INDEX "wallet_card_inventory_scope_id_idx" ON "wallet"."card_inventory"("organization_id", "branch_id", "id");
CREATE INDEX "wallet_card_inventory_scope_status_id_idx" ON "wallet"."card_inventory"("organization_id", "branch_id", "status", "id");
CREATE INDEX "wallet_card_history_card_created_idx" ON "wallet"."card_inventory_history"("card_id", "created_at", "id");
CREATE INDEX "wallet_card_history_actor_created_idx" ON "wallet"."card_inventory_history"("actor_user_id", "created_at", "id");
CREATE INDEX "wallet_card_history_correlation_idx" ON "wallet"."card_inventory_history"("correlation_id");
CREATE INDEX "wallet_idempotency_created_idx" ON "wallet"."idempotency_commands"("created_at");
CREATE INDEX "wallet_outbox_delivery_idx" ON "wallet"."outbox_events"("published_at", "dead_lettered_at", "available_at", "created_at");
