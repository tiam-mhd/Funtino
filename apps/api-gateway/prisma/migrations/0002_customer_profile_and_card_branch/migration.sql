ALTER TABLE "users"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "birth_date" TIMESTAMP(3),
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "avatar_preset" TEXT,
  ADD COLUMN "profile_completed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "user_avatars" (
  "user_id" UUID NOT NULL,
  "mime_type" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_avatars"
  ADD CONSTRAINT "user_avatars_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cards" ADD COLUMN "branch_id" UUID;

CREATE INDEX "cards_branch_id_status_idx" ON "cards"("branch_id", "status");

ALTER TABLE "cards"
  ADD CONSTRAINT "cards_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
