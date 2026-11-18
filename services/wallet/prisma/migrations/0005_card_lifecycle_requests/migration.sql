CREATE TYPE "wallet"."card_lifecycle_request_action" AS ENUM ('lost', 'replacement');
CREATE TYPE "wallet"."card_lifecycle_request_status" AS ENUM ('requested', 'in_review', 'approved', 'rejected', 'completed');

CREATE TABLE "wallet"."card_lifecycle_requests" (
  "id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "replacement_card_id" UUID,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "member_id" UUID,
  "action" "wallet"."card_lifecycle_request_action" NOT NULL,
  "status" "wallet"."card_lifecycle_request_status" NOT NULL DEFAULT 'requested',
  "reason" VARCHAR(500) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_lifecycle_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_card_lifecycle_card_fkey" FOREIGN KEY ("card_id")
    REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_card_lifecycle_replacement_card_fkey" FOREIGN KEY ("replacement_card_id")
    REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "wallet_card_lifecycle_idempotency_key" ON "wallet"."card_lifecycle_requests"("idempotency_key");
CREATE INDEX "wallet_card_lifecycle_household_created_idx"
  ON "wallet"."card_lifecycle_requests"("household_id", "created_at", "id");
CREATE INDEX "wallet_card_lifecycle_scope_status_idx"
  ON "wallet"."card_lifecycle_requests"("organization_id", "branch_id", "status", "created_at");
CREATE UNIQUE INDEX "wallet_card_lifecycle_replacement_card_key"
  ON "wallet"."card_lifecycle_requests"("replacement_card_id");

CREATE TABLE "wallet"."card_lifecycle_request_history" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_type" VARCHAR(40) NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "status" "wallet"."card_lifecycle_request_status" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "command_hash" CHAR(64) NOT NULL,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_lifecycle_request_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_card_lifecycle_history_request_fkey" FOREIGN KEY ("request_id")
    REFERENCES "wallet"."card_lifecycle_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "wallet_card_lifecycle_history_request_created_idx"
  ON "wallet"."card_lifecycle_request_history"("request_id", "created_at", "id");
CREATE UNIQUE INDEX "wallet_card_lifecycle_history_idempotency_key"
  ON "wallet"."card_lifecycle_request_history"("idempotency_key");

CREATE FUNCTION "wallet"."prevent_card_lifecycle_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet card lifecycle history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "wallet_card_lifecycle_history_no_update"
  BEFORE UPDATE OR DELETE ON "wallet"."card_lifecycle_request_history"
  FOR EACH ROW EXECUTE FUNCTION "wallet"."prevent_card_lifecycle_history_mutation"();
