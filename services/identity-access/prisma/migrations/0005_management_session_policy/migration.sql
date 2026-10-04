ALTER TABLE "policy_state"
  ADD COLUMN "management_session_ttl_hours" INTEGER NOT NULL DEFAULT 12,
  ADD CONSTRAINT "policy_state_management_session_ttl_hours_check"
    CHECK ("management_session_ttl_hours" BETWEEN 1 AND 12);
