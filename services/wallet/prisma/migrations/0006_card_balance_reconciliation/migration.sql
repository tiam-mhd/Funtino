CREATE TABLE "wallet"."card_balance_reconciliations" (
  "id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "member_id" UUID,
  "snapshot_version" VARCHAR(120) NOT NULL,
  "local_sequence" BIGINT NOT NULL,
  "balance_rial" BIGINT NOT NULL,
  "previous_balance_rial" BIGINT,
  "difference_rial" BIGINT,
  "currency_code" CHAR(3) NOT NULL,
  "freshness" "wallet"."balance_freshness" NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_balance_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_balance_reconciliation_card_fkey" FOREIGN KEY ("card_id")
    REFERENCES "wallet"."card_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_balance_reconciliation_currency_check" CHECK ("currency_code" = 'IRR'),
  CONSTRAINT "wallet_balance_reconciliation_amount_check" CHECK ("balance_rial" >= 0)
);

ALTER TABLE "wallet"."card_balance_projections"
  ADD COLUMN "last_snapshot_source_instance_id" UUID,
  ADD COLUMN "last_snapshot_local_sequence" BIGINT;

CREATE UNIQUE INDEX "wallet_balance_reconciliation_snapshot_key"
  ON "wallet"."card_balance_reconciliations"("snapshot_id");
CREATE INDEX "wallet_balance_reconciliation_scope_observed_idx"
  ON "wallet"."card_balance_reconciliations"("organization_id", "branch_id", "observed_at");
CREATE INDEX "wallet_balance_reconciliation_card_observed_idx"
  ON "wallet"."card_balance_reconciliations"("card_id", "observed_at");

CREATE FUNCTION "wallet"."prevent_card_balance_reconciliation_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet card balance reconciliation audit is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "wallet_card_balance_reconciliations_no_update"
  BEFORE UPDATE OR DELETE ON "wallet"."card_balance_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION "wallet"."prevent_card_balance_reconciliation_mutation"();
