ALTER TABLE "device_integration"."device_transaction_imports"
  ADD COLUMN "source_device_id" VARCHAR(160),
  ADD COLUMN "device_id" UUID;

CREATE INDEX "device_transaction_imports_device_received_idx"
  ON "device_integration"."device_transaction_imports"("device_id", "received_at");
