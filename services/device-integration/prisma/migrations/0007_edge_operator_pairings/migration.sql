CREATE TABLE IF NOT EXISTS "device_integration"."edge_operator_pairings" (
  "id" UUID NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "pairing_code_hash" CHAR(64) NOT NULL,
  "poll_secret_hash" CHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "actor_user_id" UUID,
  "management_session_id" UUID,
  "permission_keys" JSONB,
  "approval_idempotency_key" UUID,
  "approval_request_hash" CHAR(64),
  "approved_at" TIMESTAMPTZ(6),
  "claimed_at" TIMESTAMPTZ(6),
  "issued_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_operator_pairings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "edge_operator_pairings_installation_fkey"
    FOREIGN KEY ("source_instance_id") REFERENCES "device_integration"."edge_installations"("source_instance_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "edge_operator_pairings_status_check"
    CHECK ("status" IN ('pending', 'approved', 'claimed', 'issued', 'failed', 'cancelled', 'expired')),
  CONSTRAINT "edge_operator_pairings_approval_state_check"
    CHECK (
      ("status" = 'pending' AND "actor_user_id" IS NULL AND "management_session_id" IS NULL AND "permission_keys" IS NULL)
      OR ("status" IN ('expired', 'cancelled') AND (
        ("actor_user_id" IS NULL AND "management_session_id" IS NULL AND "permission_keys" IS NULL)
        OR ("actor_user_id" IS NOT NULL AND "management_session_id" IS NOT NULL AND "permission_keys" IS NOT NULL)
      ))
      OR ("status" IN ('approved', 'claimed', 'issued', 'failed') AND
        "actor_user_id" IS NOT NULL AND "management_session_id" IS NOT NULL AND "permission_keys" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "edge_operator_pairings_pairing_code_hash_key"
  ON "device_integration"."edge_operator_pairings"("pairing_code_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "edge_operator_pairings_approval_idempotency_key_key"
  ON "device_integration"."edge_operator_pairings"("approval_idempotency_key");
CREATE INDEX IF NOT EXISTS "edge_operator_pairings_install_status_expiry_idx"
  ON "device_integration"."edge_operator_pairings"("source_instance_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "edge_operator_pairings_actor_created_idx"
  ON "device_integration"."edge_operator_pairings"("actor_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "device_integration"."edge_operator_pairing_rate_limits" (
  "actor_user_id" UUID NOT NULL,
  "window_started_at" TIMESTAMPTZ(0) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_operator_pairing_rate_limits_pkey" PRIMARY KEY ("actor_user_id", "window_started_at"),
  CONSTRAINT "edge_operator_pairing_rate_limits_count_check" CHECK ("attempt_count" >= 0)
);
