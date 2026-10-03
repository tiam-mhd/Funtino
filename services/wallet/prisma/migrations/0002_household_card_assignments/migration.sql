CREATE TYPE "wallet"."card_assignment_action" AS ENUM ('assigned', 'transferred', 'cancelled');

CREATE TABLE "wallet"."active_card_assignments" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "active_card_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_active_assignment_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "wallet"."card_assignment_history" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "previous_household_id" UUID,
    "action" "wallet"."card_assignment_action" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "caller_service" VARCHAR(80) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "card_assignment_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_assignment_history_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "wallet_assignment_history_reason_nonempty_check" CHECK (length(trim("reason")) > 0),
    CONSTRAINT "wallet_assignment_history_transfer_shape_check" CHECK (("action" = 'transferred') = ("previous_household_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "wallet_active_assignment_card_key" ON "wallet"."active_card_assignments"("card_id");
CREATE UNIQUE INDEX "wallet_active_assignment_household_branch_key" ON "wallet"."active_card_assignments"("household_id", "branch_id");
CREATE INDEX "wallet_active_assignment_scope_id_idx" ON "wallet"."active_card_assignments"("organization_id", "branch_id", "id");
CREATE INDEX "wallet_active_assignment_household_idx" ON "wallet"."active_card_assignments"("household_id", "branch_id");
CREATE INDEX "wallet_assignment_history_card_created_idx" ON "wallet"."card_assignment_history"("card_id", "created_at", "id");
CREATE INDEX "wallet_assignment_history_household_created_idx" ON "wallet"."card_assignment_history"("household_id", "branch_id", "created_at");
CREATE INDEX "wallet_assignment_history_actor_created_idx" ON "wallet"."card_assignment_history"("actor_user_id", "created_at", "id");
CREATE INDEX "wallet_assignment_history_correlation_idx" ON "wallet"."card_assignment_history"("correlation_id");

ALTER TYPE "wallet"."card_inventory_status" ADD VALUE 'assigned';
