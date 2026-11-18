ALTER TABLE "wallet"."active_card_assignments"
  ADD COLUMN "member_id" UUID;

ALTER TABLE "wallet"."card_assignment_history"
  ADD COLUMN "member_id" UUID,
  ADD COLUMN "previous_member_id" UUID;

DROP INDEX "wallet"."wallet_active_assignment_household_branch_key";

CREATE INDEX "wallet_active_assignment_household_member_idx"
  ON "wallet"."active_card_assignments"("household_id", "member_id", "branch_id");

CREATE TYPE "wallet"."card_ledger_kind" AS ENUM
  ('top_up', 'spend', 'refund', 'adjustment', 'issuance', 'card_replacement');
CREATE TYPE "wallet"."balance_freshness" AS ENUM
  ('fresh', 'pending_sync', 'stale', 'unknown');
CREATE TYPE "wallet"."edge_operation_result" AS ENUM
  ('success', 'cancelled', 'failed');
CREATE TYPE "wallet"."edge_event_status" AS ENUM
  ('accepted', 'pending_review', 'rejected');
CREATE TYPE "wallet"."legacy_device_import_status" AS ENUM
  ('resolved', 'needs_mapping');

CREATE TABLE "wallet"."card_ledger_entries" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "source_instance_id" VARCHAR(160) NOT NULL,
  "local_transaction_id" VARCHAR(160) NOT NULL,
  "source_database" VARCHAR(160) NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "member_id" UUID,
  "device_id" UUID,
  "source_device_id" VARCHAR(160),
  "transaction_kind" "wallet"."card_ledger_kind" NOT NULL,
  "amount_rial" BIGINT NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "gross_amount_rial" BIGINT NOT NULL,
  "discount_amount_rial" BIGINT NOT NULL,
  "net_amount_rial" BIGINT NOT NULL,
  "promotion_id" VARCHAR(160),
  "rule_id" VARCHAR(160),
  "pricing_version" VARCHAR(80),
  "reversal_of_entry_id" UUID,
  "snapshot_version" VARCHAR(120) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "local_sequence" BIGINT NOT NULL,
  "balance_after_rial" BIGINT,
  "operation_result" "wallet"."edge_operation_result" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_ledger_card_fkey" FOREIGN KEY ("card_id")
    REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_ledger_reversal_fkey" FOREIGN KEY ("reversal_of_entry_id")
    REFERENCES "wallet"."card_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_ledger_success_only_check" CHECK ("operation_result" = 'success'),
  CONSTRAINT "wallet_ledger_currency_irr_check" CHECK ("currency_code" = 'IRR'),
  CONSTRAINT "wallet_ledger_amounts_nonnegative_check" CHECK (
    "gross_amount_rial" >= 0 AND "discount_amount_rial" >= 0 AND "net_amount_rial" >= 0
    AND "discount_amount_rial" <= "gross_amount_rial"
  )
);

CREATE UNIQUE INDEX "wallet_ledger_event_id_key"
  ON "wallet"."card_ledger_entries"("event_id");
CREATE UNIQUE INDEX "wallet_ledger_source_transaction_key"
  ON "wallet"."card_ledger_entries"("source_instance_id", "local_transaction_id");
CREATE INDEX "wallet_ledger_card_occurred_idx"
  ON "wallet"."card_ledger_entries"("card_id", "occurred_at", "id");
CREATE INDEX "wallet_ledger_household_occurred_idx"
  ON "wallet"."card_ledger_entries"("household_id", "occurred_at", "id");
CREATE INDEX "wallet_ledger_scope_occurred_idx"
  ON "wallet"."card_ledger_entries"("organization_id", "branch_id", "occurred_at", "id");
CREATE INDEX "wallet_ledger_reversal_target_idx"
  ON "wallet"."card_ledger_entries"("reversal_of_entry_id");

CREATE TABLE "wallet"."card_balance_projections" (
  "card_id" UUID NOT NULL,
  "balance_rial" BIGINT,
  "last_confirmed_snapshot_at" TIMESTAMPTZ(6),
  "last_applied_event_id" UUID,
  "last_source_instance_id" VARCHAR(160),
  "last_applied_local_sequence" BIGINT,
  "freshness" "wallet"."balance_freshness" NOT NULL DEFAULT 'unknown',
  "pending_transaction_count" INTEGER NOT NULL DEFAULT 0,
  "reconciliation_difference_rial" BIGINT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_balance_projections_pkey" PRIMARY KEY ("card_id"),
  CONSTRAINT "wallet_card_balance_projection_card_fkey" FOREIGN KEY ("card_id")
    REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "wallet_balance_freshness_updated_idx"
  ON "wallet"."card_balance_projections"("freshness", "updated_at");

CREATE TABLE "wallet"."edge_event_inbox" (
  "event_id" UUID NOT NULL,
  "source_instance_id" VARCHAR(160) NOT NULL,
  "local_transaction_id" VARCHAR(160) NOT NULL,
  "card_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "event_payload" JSONB NOT NULL,
  "status" "wallet"."edge_event_status" NOT NULL,
  "error_code" VARCHAR(80),
  "retryable" BOOLEAN NOT NULL DEFAULT FALSE,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMPTZ(6),
  CONSTRAINT "edge_event_inbox_pkey" PRIMARY KEY ("event_id")
);
CREATE UNIQUE INDEX "wallet_edge_inbox_source_transaction_key"
  ON "wallet"."edge_event_inbox"("source_instance_id", "local_transaction_id");
CREATE INDEX "wallet_edge_inbox_pending_idx"
  ON "wallet"."edge_event_inbox"("status", "card_id", "received_at");

CREATE TABLE "wallet"."legacy_device_imports" (
  "external_event_id" VARCHAR(160) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "transaction_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "card_id" UUID,
  "device_id" UUID,
  "source_device_id" VARCHAR(160),
  "transaction_kind" VARCHAR(40) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "wallet"."legacy_device_import_status" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_device_imports_pkey" PRIMARY KEY ("external_event_id"),
  CONSTRAINT "wallet_legacy_import_card_fkey" FOREIGN KEY ("card_id")
    REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "wallet_legacy_import_card_occurred_idx"
  ON "wallet"."legacy_device_imports"("card_id", "occurred_at", "external_event_id");
CREATE INDEX "wallet_legacy_import_scope_created_idx"
  ON "wallet"."legacy_device_imports"("organization_id", "branch_id", "created_at");

CREATE FUNCTION "wallet"."prevent_card_ledger_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet card ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallet_card_ledger_no_update"
  BEFORE UPDATE OR DELETE ON "wallet"."card_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "wallet"."prevent_card_ledger_mutation"();
