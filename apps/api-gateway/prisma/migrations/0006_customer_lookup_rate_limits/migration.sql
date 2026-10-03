CREATE TABLE "customer_lookup_rate_limits" (
  "actor_user_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_lookup_rate_limits_pkey" PRIMARY KEY ("actor_user_id", "branch_id"),
  CONSTRAINT "customer_lookup_rate_limits_count_nonnegative_check" CHECK ("count" >= 0)
);

CREATE INDEX "customer_lookup_rate_limits_window_idx"
  ON "customer_lookup_rate_limits"("window_started_at");
