ALTER TABLE "sessions"
  ADD COLUMN "mfa_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "mfa_factor_version" INTEGER,
  ADD COLUMN "mfa_method" VARCHAR(16),
  ADD CONSTRAINT "sessions_mfa_context_shape_check" CHECK (
    ("mfa_verified_at" IS NULL AND "mfa_factor_version" IS NULL AND "mfa_method" IS NULL) OR
    ("mfa_verified_at" IS NOT NULL AND "mfa_factor_version" IS NOT NULL AND "mfa_factor_version" > 0 AND "mfa_method" IS NOT NULL AND "mfa_method" IN ('totp', 'recovery'))
  );
