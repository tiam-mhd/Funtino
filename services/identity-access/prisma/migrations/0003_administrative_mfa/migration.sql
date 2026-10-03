CREATE TYPE "mfa_credential_status" AS ENUM ('pending', 'active', 'disabled');
CREATE TYPE "mfa_audit_outcome" AS ENUM ('succeeded', 'denied', 'failed');

CREATE TABLE "mfa_credentials" (
    "user_id" UUID NOT NULL,
    "status" "mfa_credential_status" NOT NULL DEFAULT 'pending',
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_nonce" BYTEA NOT NULL,
    "secret_auth_tag" BYTEA NOT NULL,
    "encryption_key_version" VARCHAR(32) NOT NULL,
    "pending_expires_at" TIMESTAMPTZ(6),
    "enabled_at" TIMESTAMPTZ(6),
    "last_accepted_step" BIGINT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "mfa_credentials_nonce_length_check" CHECK (octet_length("secret_nonce") = 12),
    CONSTRAINT "mfa_credentials_auth_tag_length_check" CHECK (octet_length("secret_auth_tag") = 16),
    CONSTRAINT "mfa_credentials_attempts_check" CHECK ("failed_attempts" >= 0),
    CONSTRAINT "mfa_credentials_version_check" CHECK ("version" > 0),
    CONSTRAINT "mfa_credentials_key_version_check" CHECK (length(btrim("encryption_key_version")) > 0),
    CONSTRAINT "mfa_credentials_status_shape_check" CHECK (
      ("status" = 'pending' AND "pending_expires_at" IS NOT NULL AND "enabled_at" IS NULL) OR
      ("status" = 'active' AND "pending_expires_at" IS NULL AND "enabled_at" IS NOT NULL) OR
      ("status" = 'disabled' AND "pending_expires_at" IS NULL AND "enabled_at" IS NULL)
    )
);

CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_recovery_codes_credential_version_check" CHECK ("credential_version" > 0),
    CONSTRAINT "mfa_recovery_codes_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "mfa_recovery_codes_terminal_state_check" CHECK (NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL)),
    CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "mfa_credentials"("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mfa_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(160) NOT NULL,
    "outcome" "mfa_audit_outcome" NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "details" JSONB,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_audit_logs_action_check" CHECK (length(btrim("action")) > 0),
    CONSTRAINT "mfa_audit_logs_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "mfa_credentials_status_locked_until_idx" ON "mfa_credentials"("status", "locked_until");
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");
CREATE INDEX "mfa_recovery_codes_user_id_credential_version_consumed_at_revoked_at_idx"
  ON "mfa_recovery_codes"("user_id", "credential_version", "consumed_at", "revoked_at");
CREATE INDEX "mfa_audit_logs_actor_user_id_created_at_idx" ON "mfa_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "mfa_audit_logs_session_id_created_at_idx" ON "mfa_audit_logs"("session_id", "created_at");

CREATE FUNCTION "reject_mfa_audit_row_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MFA audit log is append-only';
END;
$$;

CREATE TRIGGER "mfa_audit_logs_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "mfa_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_mfa_audit_row_mutation"();
CREATE TRIGGER "mfa_audit_logs_reject_truncate"
  BEFORE TRUNCATE ON "mfa_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mfa_audit_row_mutation"();
