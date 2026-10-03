CREATE TYPE "staff_invitation_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE "access_audit_actor_type" AS ENUM ('user', 'system');

ALTER TABLE "access_audit_logs"
  ADD COLUMN "actor_type" "access_audit_actor_type" NOT NULL DEFAULT 'user',
  ADD COLUMN "actor_label" VARCHAR(100),
  ALTER COLUMN "actor_user_id" DROP NOT NULL;

ALTER TABLE "access_audit_logs"
  ADD CONSTRAINT "access_audit_logs_actor_shape_check" CHECK (
    ("actor_type" = 'user' AND "actor_user_id" IS NOT NULL AND "actor_label" IS NULL) OR
    ("actor_type" = 'system' AND "actor_user_id" IS NULL AND "actor_label" IS NOT NULL AND length(btrim("actor_label")) > 0)
  );

CREATE TABLE "staff_invitations" (
  "id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "phone_lookup_hash" CHAR(64) NOT NULL,
  "phone_lookup_hash_key_version" VARCHAR(32) NOT NULL,
  "masked_phone" VARCHAR(32) NOT NULL,
  "scope_type" "access_scope_type" NOT NULL,
  "organization_id" UUID,
  "branch_id" UUID,
  "role_id" UUID NOT NULL,
  "role_version" INTEGER NOT NULL,
  "status" "staff_invitation_status" NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_invitations_membership_id_key" UNIQUE ("membership_id"),
  CONSTRAINT "staff_invitations_role_id_fkey" FOREIGN KEY ("role_id")
    REFERENCES "access_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_scope_shape_check" CHECK (
    ("scope_type" = 'global' AND "organization_id" IS NULL AND "branch_id" IS NULL) OR
    ("scope_type" = 'organization' AND "organization_id" IS NOT NULL AND "branch_id" IS NULL) OR
    ("scope_type" = 'branch' AND "organization_id" IS NOT NULL AND "branch_id" IS NOT NULL)
  ),
  CONSTRAINT "staff_invitations_phone_hash_check" CHECK (
    "phone_lookup_hash" ~ '^[0-9a-f]{64}$' AND length(btrim("phone_lookup_hash_key_version")) > 0
  ),
  CONSTRAINT "staff_invitations_role_version_check" CHECK ("role_version" > 0),
  CONSTRAINT "staff_invitations_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "staff_invitations_status_shape_check" CHECK (
    ("status" IN ('pending', 'expired') AND "accepted_at" IS NULL AND "revoked_at" IS NULL) OR
    ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "revoked_at" IS NULL) OR
    ("status" = 'revoked' AND "accepted_at" IS NULL AND "revoked_at" IS NOT NULL)
  )
);

CREATE INDEX "staff_invitations_phone_status_expiry_idx"
  ON "staff_invitations"("phone_lookup_hash_key_version", "phone_lookup_hash", "status", "expires_at");
CREATE INDEX "staff_invitations_scope_status_expiry_idx"
  ON "staff_invitations"("organization_id", "branch_id", "status", "expires_at");
CREATE UNIQUE INDEX "staff_invitations_pending_global_phone_unique"
  ON "staff_invitations"("phone_lookup_hash_key_version", "phone_lookup_hash")
  WHERE "status" = 'pending' AND "scope_type" = 'global';
CREATE UNIQUE INDEX "staff_invitations_pending_organization_phone_unique"
  ON "staff_invitations"("phone_lookup_hash_key_version", "phone_lookup_hash", "organization_id")
  WHERE "status" = 'pending' AND "scope_type" = 'organization';
CREATE UNIQUE INDEX "staff_invitations_pending_branch_phone_unique"
  ON "staff_invitations"("phone_lookup_hash_key_version", "phone_lookup_hash", "organization_id", "branch_id")
  WHERE "status" = 'pending' AND "scope_type" = 'branch';

CREATE TABLE "access_idempotency_records" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "operation" VARCHAR(120) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "request_hash_key_version" VARCHAR(32) NOT NULL,
  "response_status" INTEGER,
  "response_body" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "access_idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "access_idempotency_records_actor_operation_key_key"
    UNIQUE ("actor_user_id", "operation", "key"),
  CONSTRAINT "access_idempotency_records_request_hash_check" CHECK (
    "request_hash" ~ '^[0-9a-f]{64}$' AND length(btrim("request_hash_key_version")) > 0
  ),
  CONSTRAINT "access_idempotency_records_operation_check" CHECK (length(btrim("operation")) > 0),
  CONSTRAINT "access_idempotency_records_key_check" CHECK (length("key") BETWEEN 16 AND 128),
  CONSTRAINT "access_idempotency_records_completion_shape_check" CHECK (
    ("response_status" IS NULL AND "response_body" IS NULL AND "completed_at" IS NULL) OR
    ("response_status" BETWEEN 100 AND 599 AND "response_body" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);

CREATE INDEX "access_idempotency_records_created_at_idx" ON "access_idempotency_records"("created_at");
