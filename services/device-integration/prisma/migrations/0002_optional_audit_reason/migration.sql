SET lock_timeout = '5s';
SET statement_timeout = '120s';

ALTER TABLE "device_integration"."device_audit_logs"
  ALTER COLUMN "reason" DROP NOT NULL;

RESET statement_timeout;
RESET lock_timeout;
