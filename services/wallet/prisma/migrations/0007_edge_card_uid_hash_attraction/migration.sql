ALTER TABLE "wallet"."card_inventory"
  ADD COLUMN "card_uid_hash" CHAR(64);

ALTER TABLE "wallet"."card_inventory"
  ADD CONSTRAINT "wallet_card_uid_hash_format_check"
  CHECK ("card_uid_hash" IS NULL OR "card_uid_hash" ~ '^[a-f0-9]{64}$');

CREATE UNIQUE INDEX "wallet_card_uid_hash_key"
  ON "wallet"."card_inventory"("card_uid_hash");

ALTER TABLE "wallet"."card_ledger_entries"
  ADD COLUMN "attraction_id" UUID;
