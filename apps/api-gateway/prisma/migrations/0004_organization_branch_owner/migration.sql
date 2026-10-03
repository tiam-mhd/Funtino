-- Branch identity is now owned by services/organization-branch. Keep the legacy
-- organizations/branches/memberships tables for the rollback window and IAM migration.
-- The branch UUID remains on cards as an opaque, owner-validated reference.
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_branch_id_fkey";
