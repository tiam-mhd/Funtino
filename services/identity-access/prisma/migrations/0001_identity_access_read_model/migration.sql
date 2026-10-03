CREATE SCHEMA IF NOT EXISTS "identity_access";

CREATE TYPE "access_scope_type" AS ENUM ('global', 'organization', 'branch');
CREATE TYPE "access_role_status" AS ENUM ('active', 'disabled');
CREATE TYPE "staff_membership_status" AS ENUM ('pending', 'active', 'suspended', 'revoked');
CREATE TYPE "permission_override_effect" AS ENUM ('allow', 'deny');

CREATE TABLE "access_roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "scope_type" "access_scope_type" NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "status" "access_role_status" NOT NULL DEFAULT 'active',
    "system_managed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "access_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_roles_scope_shape_check" CHECK (
      ("scope_type" = 'global' AND "organization_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'organization' AND "organization_id" IS NOT NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'branch' AND "organization_id" IS NOT NULL AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "access_roles_version_check" CHECK ("version" > 0)
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" VARCHAR(120) NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_key"),
    CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "access_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "staff_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope_type" "access_scope_type" NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "role_id" UUID NOT NULL,
    "status" "staff_membership_status" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "staff_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_memberships_scope_shape_check" CHECK (
      ("scope_type" = 'global' AND "organization_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'organization' AND "organization_id" IS NOT NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'branch' AND "organization_id" IS NOT NULL AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "staff_memberships_version_check" CHECK ("version" > 0),
    CONSTRAINT "staff_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "access_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "permission_overrides" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "permission_key" VARCHAR(120) NOT NULL,
    "effect" "permission_override_effect" NOT NULL,
    "scope_type" "access_scope_type" NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "resource_type" VARCHAR(80),
    "resource_id" VARCHAR(160),
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permission_overrides_scope_shape_check" CHECK (
      ("scope_type" = 'global' AND "organization_id" IS NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'organization' AND "organization_id" IS NOT NULL AND "branch_id" IS NULL) OR
      ("scope_type" = 'branch' AND "organization_id" IS NOT NULL AND "branch_id" IS NOT NULL)
    ),
    CONSTRAINT "permission_overrides_resource_shape_check" CHECK (
      ("resource_type" IS NULL AND "resource_id" IS NULL) OR
      ("resource_type" IS NOT NULL AND "resource_id" IS NOT NULL)
    ),
    CONSTRAINT "permission_overrides_expiry_check" CHECK (
      "expires_at" IS NULL OR "expires_at" > "starts_at"
    ),
    CONSTRAINT "permission_overrides_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "staff_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "policy_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "policy_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "policy_state_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "policy_state_version_check" CHECK ("version" > 0)
);

CREATE INDEX "access_roles_organization_id_branch_id_status_idx" ON "access_roles"("organization_id", "branch_id", "status");
CREATE UNIQUE INDEX "access_roles_global_name_unique" ON "access_roles"(lower("name")) WHERE "scope_type" = 'global';
CREATE UNIQUE INDEX "access_roles_organization_name_unique" ON "access_roles"("organization_id", lower("name")) WHERE "scope_type" = 'organization';
CREATE UNIQUE INDEX "access_roles_branch_name_unique" ON "access_roles"("branch_id", lower("name")) WHERE "scope_type" = 'branch';

CREATE INDEX "staff_memberships_user_id_status_idx" ON "staff_memberships"("user_id", "status");
CREATE INDEX "staff_memberships_organization_id_branch_id_status_idx" ON "staff_memberships"("organization_id", "branch_id", "status");
CREATE UNIQUE INDEX "staff_memberships_global_user_unique" ON "staff_memberships"("user_id") WHERE "scope_type" = 'global' AND "status" <> 'revoked';
CREATE UNIQUE INDEX "staff_memberships_organization_user_unique" ON "staff_memberships"("user_id", "organization_id") WHERE "scope_type" = 'organization' AND "status" <> 'revoked';
CREATE UNIQUE INDEX "staff_memberships_branch_user_unique" ON "staff_memberships"("user_id", "branch_id") WHERE "scope_type" = 'branch' AND "status" <> 'revoked';

CREATE INDEX "permission_overrides_membership_id_revoked_at_permission_key_idx" ON "permission_overrides"("membership_id", "revoked_at", "permission_key");
INSERT INTO "policy_state" ("id", "version", "updated_at") VALUES (1, 1, CURRENT_TIMESTAMP);
