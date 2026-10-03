ALTER TABLE "sessions"
  ADD COLUMN "is_system_admin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_login_deadline_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "sessions_is_system_admin_last_activity_at_idx"
  ON "sessions"("is_system_admin", "last_activity_at");
