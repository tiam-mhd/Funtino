CREATE TYPE "pricing_promotions"."pricing_version_status" AS ENUM ('draft', 'active', 'retired');

CREATE TABLE "pricing_promotions"."pricing_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID,
  "branch_id" UUID,
  "version" INTEGER NOT NULL,
  "status" "pricing_promotions"."pricing_version_status" NOT NULL DEFAULT 'draft',
  "valid_from" TIMESTAMPTZ(6),
  "valid_until" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_versions_validity_check" CHECK (
    "valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from"
  )
);
CREATE UNIQUE INDEX "pricing_versions_scope_version_key"
  ON "pricing_promotions"."pricing_versions"("organization_id", "branch_id", "version");
CREATE UNIQUE INDEX "pricing_versions_global_version_key"
  ON "pricing_promotions"."pricing_versions"("version")
  WHERE "organization_id" IS NULL AND "branch_id" IS NULL;
CREATE UNIQUE INDEX "pricing_versions_org_version_key"
  ON "pricing_promotions"."pricing_versions"("organization_id", "version")
  WHERE "organization_id" IS NOT NULL AND "branch_id" IS NULL;
CREATE INDEX "pricing_versions_scope_status_idx"
  ON "pricing_promotions"."pricing_versions"("organization_id", "branch_id", "status");

CREATE TABLE "pricing_promotions"."pricing_rules" (
  "id" UUID NOT NULL,
  "pricing_version_id" UUID NOT NULL,
  "rule_id" VARCHAR(160) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "priority" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_rules_version_fkey" FOREIGN KEY ("pricing_version_id")
    REFERENCES "pricing_promotions"."pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pricing_rules_version_rule_key"
  ON "pricing_promotions"."pricing_rules"("pricing_version_id", "rule_id");
CREATE INDEX "pricing_rules_version_priority_idx"
  ON "pricing_promotions"."pricing_rules"("pricing_version_id", "priority", "id");

CREATE TABLE "pricing_promotions"."pricing_audit" (
  "id" UUID NOT NULL,
  "pricing_version_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_audit_version_fkey" FOREIGN KEY ("pricing_version_id")
    REFERENCES "pricing_promotions"."pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pricing_audit_idempotency_key" ON "pricing_promotions"."pricing_audit"("idempotency_key");
CREATE INDEX "pricing_audit_version_created_idx" ON "pricing_promotions"."pricing_audit"("pricing_version_id", "created_at");
CREATE INDEX "pricing_audit_actor_created_idx" ON "pricing_promotions"."pricing_audit"("actor_user_id", "created_at");

CREATE TABLE "pricing_promotions"."outbox_events" (
  "id" UUID NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "envelope" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "published_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(80),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pricing_outbox_delivery_idx"
  ON "pricing_promotions"."outbox_events"("published_at", "dead_lettered_at", "available_at", "created_at");

CREATE TABLE "pricing_promotions"."inbox_events" (
  "event_id" UUID NOT NULL,
  "consumer_name" VARCHAR(120) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMPTZ(6),
  CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id", "consumer_name")
);
CREATE INDEX "pricing_inbox_consumer_received_idx"
  ON "pricing_promotions"."inbox_events"("consumer_name", "received_at");

CREATE FUNCTION "pricing_promotions"."prevent_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pricing audit is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "pricing_audit_no_update"
  BEFORE UPDATE OR DELETE ON "pricing_promotions"."pricing_audit"
  FOR EACH ROW EXECUTE FUNCTION "pricing_promotions"."prevent_audit_mutation"();
