SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 110000 THEN
    RAISE EXCEPTION 'API Gateway migration requires PostgreSQL 11 or newer';
  END IF;
END
$$;

ALTER TABLE "users"
ADD COLUMN "management_password_hash" VARCHAR(200),
ADD COLUMN "management_password_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "management_password_locked_until" TIMESTAMPTZ(6);

ALTER TABLE "otp_challenges"
ADD COLUMN "purpose" VARCHAR(32) NOT NULL DEFAULT 'customer_login';

ALTER TABLE "sessions"
ADD COLUMN "audience" VARCHAR(16) NOT NULL DEFAULT 'customer';

CREATE TABLE "otp_request_throttles" (
  "key" CHAR(64) NOT NULL,
  "next_allowed_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_request_throttles_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "management_login_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "management_login_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "management_login_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "management_login_challenges_token_hash_key"
ON "management_login_challenges"("token_hash");

CREATE INDEX "management_login_challenges_user_id_expires_at_idx"
ON "management_login_challenges"("user_id", "expires_at");

RESET statement_timeout;
RESET lock_timeout;
