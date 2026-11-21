CREATE TABLE "edge_operator_tokens" (
  "id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "permission_keys" JSONB NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "catalog_version" INTEGER NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  CONSTRAINT "edge_operator_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "edge_operator_tokens_hash_check" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "edge_operator_tokens_permission_keys_check" CHECK (jsonb_typeof("permission_keys") = 'array'),
  CONSTRAINT "edge_operator_tokens_version_check" CHECK ("policy_version" > 0 AND "catalog_version" > 0),
  CONSTRAINT "edge_operator_tokens_expiry_check" CHECK ("expires_at" > "issued_at")
);

CREATE UNIQUE INDEX "edge_operator_tokens_hash_key" ON "edge_operator_tokens"("token_hash");
CREATE INDEX "edge_operator_tokens_actor_expiry_idx" ON "edge_operator_tokens"("actor_user_id", "expires_at", "revoked_at");
CREATE INDEX "edge_operator_tokens_scope_expiry_idx" ON "edge_operator_tokens"("organization_id", "branch_id", "expires_at");

CREATE TABLE "edge_operator_token_audit" (
  "id" UUID NOT NULL,
  "token_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "permission_keys" JSONB NOT NULL,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edge_operator_token_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "edge_operator_token_audit_action_check" CHECK ("action" IN ('issued', 'revoked')),
  CONSTRAINT "edge_operator_token_audit_permission_keys_check" CHECK (jsonb_typeof("permission_keys") = 'array'),
  CONSTRAINT "edge_operator_token_audit_token_fkey" FOREIGN KEY ("token_id") REFERENCES "edge_operator_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "edge_operator_token_audit_actor_created_idx" ON "edge_operator_token_audit"("actor_user_id", "created_at", "id");
CREATE INDEX "edge_operator_token_audit_token_created_idx" ON "edge_operator_token_audit"("token_id", "created_at");

CREATE FUNCTION "prevent_edge_operator_token_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'edge_operator_token_audit rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "edge_operator_token_audit_append_only"
  BEFORE UPDATE OR DELETE ON "edge_operator_token_audit"
  FOR EACH ROW EXECUTE FUNCTION "prevent_edge_operator_token_audit_mutation"();
