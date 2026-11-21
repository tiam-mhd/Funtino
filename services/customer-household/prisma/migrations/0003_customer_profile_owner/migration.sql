-- Additive ownership cutover target. Existing API Gateway columns are retained
-- as a rollback source until the separately reviewed backfill is complete.
CREATE TYPE "customer_household"."customer_profile_gender" AS ENUM (
  'female',
  'male',
  'other',
  'prefer_not_to_say'
);

CREATE TABLE "customer_household"."customer_profiles" (
  "user_id" UUID NOT NULL,
  "first_name" VARCHAR(60),
  "last_name" VARCHAR(60),
  "email" VARCHAR(160),
  "birth_date" DATE,
  "gender" "customer_household"."customer_profile_gender",
  "city" VARCHAR(80),
  "avatar_preset" VARCHAR(32),
  "avatar_data" BYTEA,
  "avatar_mime_type" VARCHAR(80),
  "avatar_updated_at" TIMESTAMPTZ(6),
  "profile_completed_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "customer_profiles_version_check" CHECK ("version" > 0),
  CONSTRAINT "customer_profiles_avatar_check" CHECK (
    ("avatar_data" IS NULL AND "avatar_mime_type" IS NULL AND "avatar_updated_at" IS NULL)
    OR ("avatar_data" IS NOT NULL AND "avatar_mime_type" IS NOT NULL AND "avatar_updated_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "customer_profiles_email_key"
  ON "customer_household"."customer_profiles"("email");

-- Rollback is intentionally manual and safe only before any profile backfill
-- or new writes: DROP TABLE customer_household.customer_profiles; then DROP
-- TYPE customer_household.customer_profile_gender. Never delete profile data
-- after writes begin; use a forward repair migration instead.
