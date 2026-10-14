SET lock_timeout = '5s';
SET statement_timeout = '120s';

ALTER TABLE "wallet"."card_inventory_history"
  ALTER COLUMN "reason" DROP NOT NULL;

RESET statement_timeout;
RESET lock_timeout;
