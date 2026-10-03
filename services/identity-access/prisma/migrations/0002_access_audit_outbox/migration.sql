CREATE TYPE "access_audit_outcome" AS ENUM ('succeeded', 'denied', 'failed');

CREATE TABLE "access_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(160) NOT NULL,
    "scope_type" "access_scope_type" NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "policy_version" INTEGER,
    "correlation_id" UUID NOT NULL,
    "outcome" "access_audit_outcome" NOT NULL DEFAULT 'succeeded',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_audit_logs_scope_shape_check" CHECK (
      ("scope_type" = 'global' AND "organization_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'organization' AND "organization_id" IS NOT NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'branch' AND "organization_id" IS NOT NULL AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "access_audit_logs_policy_version_check" CHECK (
      "policy_version" IS NULL OR "policy_version" > 0
    ),
    CONSTRAINT "access_audit_logs_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "event_version" INTEGER NOT NULL,
    "aggregate_id" VARCHAR(160) NOT NULL,
    "envelope" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "dead_lettered_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_audit_log_id_fkey" FOREIGN KEY ("audit_log_id")
      REFERENCES "access_audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outbox_events_event_version_check" CHECK ("event_version" > 0),
    CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "outbox_events_lease_shape_check" CHECK (
      ("lease_token" IS NULL AND "lease_expires_at" IS NULL) OR
      ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    ),
    CONSTRAINT "outbox_events_terminal_state_check" CHECK (
      NOT ("published_at" IS NOT NULL AND "dead_lettered_at" IS NOT NULL)
    ),
    CONSTRAINT "outbox_events_envelope_identity_check" CHECK (
      "envelope"->>'eventId' = "id"::text AND
      "envelope"->>'eventType' = "event_type" AND
      ("envelope"->>'eventVersion')::integer = "event_version" AND
      "envelope"->>'sourceId' = 'identity-access' AND
      "envelope"->'payload'->>'auditId' = "audit_log_id"::text AND
      "envelope"->'payload'->>'targetId' = "aggregate_id"
    )
);

CREATE INDEX "access_audit_logs_actor_user_id_created_at_idx"
  ON "access_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "access_audit_logs_target_type_target_id_created_at_idx"
  ON "access_audit_logs"("target_type", "target_id", "created_at");
CREATE INDEX "access_audit_logs_organization_id_branch_id_created_at_idx"
  ON "access_audit_logs"("organization_id", "branch_id", "created_at");
CREATE UNIQUE INDEX "outbox_events_audit_log_id_key" ON "outbox_events"("audit_log_id");
CREATE INDEX "outbox_events_published_at_dead_lettered_at_available_at_created_at_idx"
  ON "outbox_events"("published_at", "dead_lettered_at", "available_at", "created_at");

CREATE FUNCTION "reject_access_audit_row_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'access audit log is append-only';
END;
$$;

CREATE TRIGGER "access_audit_logs_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "access_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_access_audit_row_mutation"();
CREATE TRIGGER "access_audit_logs_reject_truncate"
  BEFORE TRUNCATE ON "access_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_access_audit_row_mutation"();
