ALTER TABLE "access_roles"
ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

DROP INDEX "access_roles_global_name_unique";
DROP INDEX "access_roles_organization_name_unique";
DROP INDEX "access_roles_branch_name_unique";

CREATE UNIQUE INDEX "access_roles_global_name_unique"
ON "access_roles"(lower("name"))
WHERE "scope_type" = 'global' AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "access_roles_organization_name_unique"
ON "access_roles"("organization_id", lower("name"))
WHERE "scope_type" = 'organization' AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "access_roles_branch_name_unique"
ON "access_roles"("branch_id", lower("name"))
WHERE "scope_type" = 'branch' AND "deleted_at" IS NULL;
