CREATE TYPE "customer_household"."provisional_customer_status" AS ENUM (
  'pending_review',
  'linked',
  'rejected'
);

CREATE TABLE "customer_household"."provisional_customers" (
  "id" UUID NOT NULL,
  "provisional_id" UUID NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "status" "customer_household"."provisional_customer_status" NOT NULL DEFAULT 'pending_review',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "provisional_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_household_provisional_source_local_key"
  ON "customer_household"."provisional_customers"("source_instance_id", "provisional_id");

CREATE INDEX "customer_household_provisional_branch_status_idx"
  ON "customer_household"."provisional_customers"("branch_id", "status", "created_at");

-- Rollback before any Edge records are accepted:
-- DROP TABLE customer_household.provisional_customers;
-- DROP TYPE customer_household.provisional_customer_status;
-- After writes begin, retain pending and audit history and use a forward repair.
