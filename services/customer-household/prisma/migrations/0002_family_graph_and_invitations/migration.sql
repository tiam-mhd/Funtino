CREATE TYPE "customer_household"."household_member_gender" AS ENUM ('female', 'male', 'unspecified');
CREATE TYPE "customer_household"."household_relationship_kind" AS ENUM ('parent_of', 'spouse_of', 'sibling_of', 'guardian_of');
CREATE TYPE "customer_household"."household_relationship_basis" AS ENUM ('biological', 'legal', 'adoptive', 'step', 'partner', 'unspecified');
CREATE TYPE "customer_household"."household_invitation_kind" AS ENUM ('adult_account', 'dependent_claim');
CREATE TYPE "customer_household"."household_invitation_status" AS ENUM ('pending', 'accepted', 'declined', 'revoked', 'expired', 'claim_pending', 'linked', 'conflict_review');

ALTER TYPE "customer_household"."household_access_role" ADD VALUE 'member';
ALTER TYPE "customer_household"."household_member_status" ADD VALUE 'pending';

ALTER TABLE "customer_household"."household_members"
  ADD COLUMN "family_person_id" UUID,
  ADD COLUMN "display_gender" "customer_household"."household_member_gender",
  ADD COLUMN "is_self" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "customer_household"."family_people" (
  "id" UUID NOT NULL,
  "account_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "family_people_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_household"."household_relationships" (
  "id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "from_member_id" UUID NOT NULL,
  "to_member_id" UUID NOT NULL,
  "kind" "customer_household"."household_relationship_kind" NOT NULL,
  "basis" "customer_household"."household_relationship_basis" NOT NULL DEFAULT 'unspecified',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "household_relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_household_relationship_distinct_members_check" CHECK ("from_member_id" <> "to_member_id")
);

CREATE TABLE "customer_household"."household_invitations" (
  "id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "relative_member_id" UUID,
  "kind" "customer_household"."household_invitation_kind" NOT NULL,
  "status" "customer_household"."household_invitation_status" NOT NULL DEFAULT 'pending',
  "relationship_kind" "customer_household"."household_relationship_kind",
  "relationship_basis" "customer_household"."household_relationship_basis",
  "new_member_is_from" BOOLEAN,
  "target_user_id" UUID,
  "target_phone_hash" CHAR(64),
  "token_hash" CHAR(64) NOT NULL,
  "token_key_version" VARCHAR(16) NOT NULL DEFAULT 'v1',
  "created_by_user_id" UUID NOT NULL,
  "accepted_by_user_id" UUID,
  "claim_user_id" UUID,
  "expires_at" TIMESTAMPTZ(6),
  "accepted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "household_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_household_invitation_target_check" CHECK (
    ("kind" = 'adult_account' AND (("target_user_id" IS NOT NULL AND "target_phone_hash" IS NULL) OR ("target_user_id" IS NULL AND "target_phone_hash" IS NOT NULL)))
    OR ("kind" = 'dependent_claim' AND (("target_user_id" IS NULL AND "target_phone_hash" IS NULL) OR ("target_user_id" IS NOT NULL AND "target_phone_hash" IS NULL) OR ("target_user_id" IS NULL AND "target_phone_hash" IS NOT NULL)))
  ),
  CONSTRAINT "customer_household_invitation_expiry_check" CHECK (
    ("target_user_id" IS NOT NULL AND "expires_at" IS NULL)
    OR ("target_user_id" IS NULL AND "expires_at" IS NOT NULL)
  ),
  CONSTRAINT "customer_household_invitation_relationship_check" CHECK (
    ("relative_member_id" IS NULL AND "relationship_kind" IS NULL AND "relationship_basis" IS NULL AND "new_member_is_from" IS NULL)
    OR ("relative_member_id" IS NOT NULL AND "relationship_kind" IS NOT NULL AND "relationship_basis" IS NOT NULL AND "new_member_is_from" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "customer_household_family_person_account_user_key"
  ON "customer_household"."family_people"("account_user_id");
CREATE UNIQUE INDEX "customer_household_member_household_id_id_key"
  ON "customer_household"."household_members"("household_id", "id");
CREATE UNIQUE INDEX "customer_household_member_household_person_key"
  ON "customer_household"."household_members"("household_id", "family_person_id");
CREATE INDEX "customer_household_member_person_idx"
  ON "customer_household"."household_members"("family_person_id");
CREATE INDEX "customer_household_member_self_idx"
  ON "customer_household"."household_members"("household_id", "is_self", "status");
CREATE UNIQUE INDEX "customer_household_relationship_edge_key"
  ON "customer_household"."household_relationships"("household_id", "from_member_id", "to_member_id", "kind");
CREATE INDEX "customer_household_relationship_from_idx"
  ON "customer_household"."household_relationships"("household_id", "kind", "from_member_id");
CREATE INDEX "customer_household_relationship_to_idx"
  ON "customer_household"."household_relationships"("household_id", "kind", "to_member_id");
CREATE UNIQUE INDEX "customer_household_invitation_token_hash_key"
  ON "customer_household"."household_invitations"("token_hash");
CREATE INDEX "customer_household_invitation_target_user_idx"
  ON "customer_household"."household_invitations"("target_user_id", "status", "created_at");
CREATE INDEX "customer_household_invitation_target_phone_idx"
  ON "customer_household"."household_invitations"("target_phone_hash", "status", "created_at");
CREATE INDEX "customer_household_invitation_household_status_idx"
  ON "customer_household"."household_invitations"("household_id", "status", "created_at");
CREATE INDEX "customer_household_invitation_expiry_idx"
  ON "customer_household"."household_invitations"("expires_at", "status");
CREATE UNIQUE INDEX "customer_household_invitation_pending_user_target_key"
  ON "customer_household"."household_invitations"("household_id", "target_user_id")
  WHERE "status" = 'pending' AND "target_user_id" IS NOT NULL;
CREATE UNIQUE INDEX "customer_household_invitation_pending_phone_target_key"
  ON "customer_household"."household_invitations"("household_id", "target_phone_hash")
  WHERE "status" = 'pending' AND "target_phone_hash" IS NOT NULL;

ALTER TABLE "customer_household"."household_members"
  ADD CONSTRAINT "customer_household_member_person_fkey"
    FOREIGN KEY ("family_person_id") REFERENCES "customer_household"."family_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_household_self_dependent_check"
    CHECK (NOT "is_self" OR NOT "is_dependent");

ALTER TABLE "customer_household"."household_relationships"
  ADD CONSTRAINT "customer_household_relationship_household_fkey"
    FOREIGN KEY ("household_id") REFERENCES "customer_household"."households"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_household_relationship_from_member_fkey"
    FOREIGN KEY ("household_id", "from_member_id") REFERENCES "customer_household"."household_members"("household_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_household_relationship_to_member_fkey"
    FOREIGN KEY ("household_id", "to_member_id") REFERENCES "customer_household"."household_members"("household_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_household"."household_invitations"
  ADD CONSTRAINT "customer_household_invitation_household_fkey"
    FOREIGN KEY ("household_id") REFERENCES "customer_household"."households"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_household_invitation_member_fkey"
    FOREIGN KEY ("household_id", "member_id") REFERENCES "customer_household"."household_members"("household_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_household_invitation_relative_member_fkey"
    FOREIGN KEY ("household_id", "relative_member_id") REFERENCES "customer_household"."household_members"("household_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
