CREATE TABLE "device_integration"."edge_outbox_replay_audits" (
  "id" UUID NOT NULL,
  "outbox_event_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "caller_service" VARCHAR(80) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "previous_error_code" VARCHAR(80),
  "previous_attempts" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_outbox_replay_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "edge_outbox_replay_audits_reason_check" CHECK (char_length(btrim("reason")) >= 10)
);

CREATE UNIQUE INDEX "edge_outbox_replay_audits_idempotency_key"
  ON "device_integration"."edge_outbox_replay_audits"("idempotency_key");
CREATE INDEX "edge_outbox_replay_audits_scope_created_idx"
  ON "device_integration"."edge_outbox_replay_audits"("organization_id", "branch_id", "created_at");
CREATE INDEX "edge_outbox_replay_audits_event_created_idx"
  ON "device_integration"."edge_outbox_replay_audits"("event_id", "created_at");

CREATE FUNCTION "device_integration"."prevent_edge_outbox_replay_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'device integration edge replay audit is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "edge_outbox_replay_audits_no_update"
  BEFORE UPDATE OR DELETE ON "device_integration"."edge_outbox_replay_audits"
  FOR EACH ROW EXECUTE FUNCTION "device_integration"."prevent_edge_outbox_replay_audit_mutation"();
