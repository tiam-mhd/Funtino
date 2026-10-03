CREATE TYPE "MembershipRole" AS ENUM ('customer', 'cashier', 'operator', 'branch_manager', 'organization_manager', 'crm_manager', 'system_admin', 'support');
CREATE TYPE "AssetType" AS ENUM ('purchased_credit', 'gift_credit', 'loyalty_points');
CREATE TYPE "LedgerKind" AS ENUM ('top_up', 'spend', 'refund', 'adjustment', 'reward', 'expiry');
CREATE TYPE "CardStatus" AS ENUM ('pending_sync', 'active', 'blocked', 'unlinked');
CREATE TYPE "MissionStatus" AS ENUM ('draft', 'published', 'active', 'expired');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "display_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "otp_challenges" (
  "id" UUID NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "organizations" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "branches" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "opening_hours" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "memberships" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID,
  "role" "MembershipRole" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "households" (
  "id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "household_members" (
  "id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "user_id" UUID,
  "display_name" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "birth_date" TIMESTAMP(3),
  "is_dependent" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "cards" (
  "id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "member_id" UUID,
  "external_card_id" TEXT NOT NULL,
  "status" "CardStatus" NOT NULL DEFAULT 'pending_sync',
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "wallet_accounts" (
  "id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "card_id" UUID,
  "currency" TEXT NOT NULL DEFAULT 'IRR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ledger_entries" (
  "id" UUID NOT NULL,
  "wallet_id" UUID NOT NULL,
  "asset_type" "AssetType" NOT NULL,
  "kind" "LedgerKind" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "missions" (
  "id" UUID NOT NULL,
  "organization_id" UUID,
  "branch_id" UUID,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "MissionStatus" NOT NULL DEFAULT 'draft',
  "reward_type" TEXT NOT NULL,
  "reward_value" INTEGER NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "mission_progress" (
  "id" UUID NOT NULL,
  "mission_id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "claimed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mission_progress_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "published_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inbox_events" (
  "event_id" UUID NOT NULL,
  "consumer" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id", "consumer")
);
CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "organization_id" UUID,
  "branch_id" UUID,
  "correlation_id" TEXT NOT NULL,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");
CREATE INDEX "otp_challenges_phone_e164_created_at_idx" ON "otp_challenges"("phone_e164", "created_at");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "branches_organization_id_is_active_idx" ON "branches"("organization_id", "is_active");
CREATE UNIQUE INDEX "branches_organization_id_slug_key" ON "branches"("organization_id", "slug");
CREATE INDEX "memberships_organization_id_branch_id_role_idx" ON "memberships"("organization_id", "branch_id", "role");
CREATE UNIQUE INDEX "memberships_user_id_organization_id_branch_id_role_key" ON "memberships"("user_id", "organization_id", "branch_id", "role");
CREATE INDEX "households_owner_user_id_idx" ON "households"("owner_user_id");
CREATE INDEX "household_members_household_id_idx" ON "household_members"("household_id");
CREATE UNIQUE INDEX "cards_external_card_id_key" ON "cards"("external_card_id");
CREATE INDEX "cards_household_id_status_idx" ON "cards"("household_id", "status");
CREATE INDEX "wallet_accounts_household_id_idx" ON "wallet_accounts"("household_id");
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");
CREATE INDEX "ledger_entries_wallet_id_occurred_at_idx" ON "ledger_entries"("wallet_id", "occurred_at");
CREATE INDEX "missions_organization_id_branch_id_status_idx" ON "missions"("organization_id", "branch_id", "status");
CREATE UNIQUE INDEX "mission_progress_mission_id_household_id_key" ON "mission_progress"("mission_id", "household_id");
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "outbox_events"("published_at", "occurred_at");
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "households" ADD CONSTRAINT "households_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cards" ADD CONSTRAINT "cards_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cards" ADD CONSTRAINT "cards_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION funtino_prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are append-only';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION funtino_prevent_ledger_mutation();
