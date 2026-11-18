CREATE TABLE "device_integration"."edge_snapshots" (
  "id" UUID NOT NULL,
  "source_instance_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "version" VARCHAR(120) NOT NULL,
  "document" JSONB NOT NULL,
  "document_hash" CHAR(64) NOT NULL,
  "valid_from" TIMESTAMPTZ(6) NOT NULL,
  "valid_until" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "edge_snapshots_validity_check" CHECK ("valid_until" > "valid_from")
);
CREATE UNIQUE INDEX "edge_snapshots_instance_version_key"
  ON "device_integration"."edge_snapshots"("source_instance_id", "version");
CREATE INDEX "edge_snapshots_instance_created_idx"
  ON "device_integration"."edge_snapshots"("source_instance_id", "branch_id", "created_at");
CREATE INDEX "edge_snapshots_valid_until_idx"
  ON "device_integration"."edge_snapshots"("valid_until");

CREATE FUNCTION "device_integration"."prevent_edge_snapshot_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'device integration edge snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "edge_snapshots_no_update"
  BEFORE UPDATE OR DELETE ON "device_integration"."edge_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "device_integration"."prevent_edge_snapshot_mutation"();
