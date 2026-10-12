ALTER TABLE "permission_overrides"
  ALTER COLUMN "reason" DROP NOT NULL;

ALTER TABLE "access_audit_logs"
  DROP CONSTRAINT "access_audit_logs_reason_check",
  ALTER COLUMN "reason" DROP NOT NULL,
  ADD CONSTRAINT "access_audit_logs_reason_check"
    CHECK ("reason" IS NULL OR length(btrim("reason")) > 0);
