import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, ResourceStatus } from '../../generated/prisma/index.js';

type LegacyOrganization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  createdAtLocal: string;
  updatedAtLocal: string;
};
type LegacyBranch = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  timezone: string;
  isActive: boolean;
  openingHours: Prisma.JsonValue;
  createdAtLocal: string;
  updatedAtLocal: string;
};
type Snapshot = { organizations: LegacyOrganization[]; branches: LegacyBranch[] };
type ConflictCounts = {
  orphanBranches: number;
  duplicateOrganizationSlugs: number;
  duplicateBranchSlugs: number;
  invalidOrganizations: number;
  invalidBranches: number;
  targetMismatches: number;
};

const SOURCE_SYSTEM = 'api-gateway.public.v1';
const MAX_ROWS_FOR_SINGLE_TRANSACTION = 10_000;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validOpeningHours(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowedDays = new Set([
    'saturday',
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
  ]);
  return Object.entries(value).every(([day, hours]) => {
    if (!allowedDays.has(day)) return false;
    if (hours === null) return true;
    if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return false;
    const record = hours as Record<string, unknown>;
    const validTime = (time: unknown) =>
      typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    return Object.keys(record).length === 2 && validTime(record.open) && validTime(record.close);
  });
}

function countSourceConflicts(snapshot: Snapshot): ConflictCounts {
  const organizationIds = new Set(snapshot.organizations.map((row) => row.id));
  const organizationSlugs = snapshot.organizations.map((row) => row.slug);
  const branchKeys = snapshot.branches.map((row) => `${row.organizationId}\u0000${row.slug}`);
  return {
    orphanBranches: snapshot.branches.filter((row) => !organizationIds.has(row.organizationId))
      .length,
    duplicateOrganizationSlugs: organizationSlugs.length - new Set(organizationSlugs).size,
    duplicateBranchSlugs: branchKeys.length - new Set(branchKeys).size,
    invalidOrganizations: snapshot.organizations.filter(
      (row) =>
        row.name.trim().length < 2 ||
        row.name.length > 160 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
        row.slug.length > 80 ||
        !validTimezone(row.timezone) ||
        row.timezone.length > 64 ||
        row.createdAtLocal.length > 32 ||
        row.updatedAtLocal.length > 32,
    ).length,
    invalidBranches: snapshot.branches.filter(
      (row) =>
        row.name.trim().length < 2 ||
        row.name.length > 160 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
        row.slug.length > 80 ||
        row.address.trim().length < 3 ||
        row.address.length > 500 ||
        row.city.trim().length < 2 ||
        row.city.length > 120 ||
        !validTimezone(row.timezone) ||
        row.timezone.length > 64 ||
        !validOpeningHours(row.openingHours) ||
        row.createdAtLocal.length > 32 ||
        row.updatedAtLocal.length > 32,
    ).length,
    targetMismatches: 0,
  };
}

async function readLegacySnapshot(source: PrismaClient): Promise<{
  snapshot: Snapshot | null;
  organizations: number;
  branches: number;
}> {
  return source.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const [counts] = await tx.$queryRaw<{ organizations: string; branches: string }[]>`
      SELECT
        (SELECT COUNT(*)::text FROM public.organizations) AS organizations,
        (SELECT COUNT(*)::text FROM public.branches) AS branches
    `;
    const organizationsCount = Number(counts.organizations);
    const branchesCount = Number(counts.branches);
    if (!Number.isSafeInteger(organizationsCount) || !Number.isSafeInteger(branchesCount)) {
      throw new Error('Legacy row counts exceed the supported safe range.');
    }
    if (organizationsCount + branchesCount > MAX_ROWS_FOR_SINGLE_TRANSACTION) {
      return { snapshot: null, organizations: organizationsCount, branches: branchesCount };
    }
    const organizations = await tx.$queryRaw<LegacyOrganization[]>`
      SELECT id::text AS id, name, slug, timezone,
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "createdAtLocal",
        to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "updatedAtLocal"
      FROM public.organizations ORDER BY id
    `;
    const branches = await tx.$queryRaw<LegacyBranch[]>`
      SELECT id::text AS id, organization_id::text AS "organizationId", name, slug, address, city,
        timezone, is_active AS "isActive", opening_hours AS "openingHours",
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "createdAtLocal",
        to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "updatedAtLocal"
      FROM public.branches ORDER BY id
    `;
    return {
      snapshot: { organizations, branches },
      organizations: organizationsCount,
      branches: branchesCount,
    };
  });
}

async function inspectTarget(
  target: PrismaClient,
  snapshot: Snapshot,
  counts: ConflictCounts,
): Promise<void> {
  const organizationIds = snapshot.organizations.map((row) => row.id);
  const branchIds = snapshot.branches.map((row) => row.id);
  const [organizationsById, organizationsBySlug, branchesById] = await Promise.all([
    target.organization.findMany({ where: { id: { in: organizationIds } } }),
    target.organization.findMany({
      where: { slug: { in: snapshot.organizations.map((row) => row.slug) } },
    }),
    target.branch.findMany({ where: { id: { in: branchIds } } }),
  ]);
  const organizations = new Map(organizationsById.map((row) => [row.id, row]));
  const organizationsSlug = new Map(organizationsBySlug.map((row) => [row.slug, row]));
  const branches = new Map(branchesById.map((row) => [row.id, row]));

  for (const legacy of snapshot.organizations) {
    const byId = organizations.get(legacy.id);
    const bySlug = organizationsSlug.get(legacy.slug);
    if (bySlug && bySlug.id !== legacy.id) counts.targetMismatches += 1;
    if (
      byId &&
      (byId.name !== legacy.name ||
        byId.slug !== legacy.slug ||
        byId.timezone !== legacy.timezone ||
        byId.status !== 'active' ||
        byId.legacyCreatedAtLocal !== legacy.createdAtLocal ||
        byId.legacyUpdatedAtLocal !== legacy.updatedAtLocal)
    ) {
      counts.targetMismatches += 1;
    }
  }
  for (const legacy of snapshot.branches) {
    const current = branches.get(legacy.id);
    const expectedStatus: ResourceStatus = legacy.isActive ? 'active' : 'suspended';
    if (!current) continue;
    const owner = current.organizationId === legacy.organizationId;
    const sameOpeningHours = stableJson(current.openingHours) === stableJson(legacy.openingHours);
    if (
      !owner ||
      current.name !== legacy.name ||
      current.slug !== legacy.slug ||
      current.address !== legacy.address ||
      current.city !== legacy.city ||
      current.timezone !== legacy.timezone ||
      current.status !== expectedStatus ||
      current.legacyCreatedAtLocal !== legacy.createdAtLocal ||
      current.legacyUpdatedAtLocal !== legacy.updatedAtLocal ||
      !sameOpeningHours
    ) {
      counts.targetMismatches += 1;
    }
  }
  const targetBranchSlugs = snapshot.branches.length
    ? await target.branch.findMany({
        where: {
          OR: snapshot.branches.map((row) => ({
            organizationId: row.organizationId,
            slug: row.slug,
          })),
        },
        select: { id: true, organizationId: true, slug: true },
      })
    : [];
  const legacyByKey = new Map(
    snapshot.branches.map((row) => [`${row.organizationId}\u0000${row.slug}`, row.id]),
  );
  if (
    targetBranchSlugs.some(
      (row) => legacyByKey.get(`${row.organizationId}\u0000${row.slug}`) !== row.id,
    )
  ) {
    counts.targetMismatches += 1;
  }
}

async function applySnapshot(target: PrismaClient, snapshot: Snapshot, sourceHash: string) {
  return target.$transaction(
    async (tx) => {
      const priorRun = await tx.backfillRun.findUnique({
        where: { sourceSystem_sourceHash: { sourceSystem: SOURCE_SYSTEM, sourceHash } },
      });
      if (priorRun?.status === 'completed')
        return { status: 'already-applied', runId: priorRun.id };
      const runId = randomUUID();
      let insertedOrganizations = 0;
      let insertedBranches = 0;
      for (const row of snapshot.organizations) {
        const exists = await tx.organization.findUnique({
          where: { id: row.id },
          select: { id: true },
        });
        if (exists) continue;
        await tx.organization.create({
          data: {
            id: row.id,
            name: row.name,
            slug: row.slug,
            timezone: row.timezone,
            status: 'active',
            legacyCreatedAtLocal: row.createdAtLocal,
            legacyUpdatedAtLocal: row.updatedAtLocal,
          },
        });
        insertedOrganizations += 1;
      }
      for (const row of snapshot.branches) {
        const exists = await tx.branch.findUnique({ where: { id: row.id }, select: { id: true } });
        if (exists) continue;
        await tx.branch.create({
          data: {
            id: row.id,
            organizationId: row.organizationId,
            name: row.name,
            slug: row.slug,
            address: row.address,
            city: row.city,
            timezone: row.timezone,
            status: row.isActive ? 'active' : 'suspended',
            openingHours: row.openingHours as Prisma.InputJsonValue,
            legacyCreatedAtLocal: row.createdAtLocal,
            legacyUpdatedAtLocal: row.updatedAtLocal,
          },
        });
        insertedBranches += 1;
      }
      await tx.backfillRun.create({
        data: {
          id: runId,
          sourceSystem: SOURCE_SYSTEM,
          sourceHash,
          status: 'completed',
          organizations: snapshot.organizations.length,
          branches: snapshot.branches.length,
          insertedOrganizations,
          insertedBranches,
          completedAt: new Date(),
          summary: { strategy: 'single-transaction', legacyMembershipsMigrated: false },
        },
      });
      return { status: 'applied', runId, insertedOrganizations, insertedBranches };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

async function main(): Promise<void> {
  const sourceUrl = process.env.LEGACY_GATEWAY_READONLY_DATABASE_URL;
  const targetUrl = process.env.ORGANIZATION_BRANCH_BACKFILL_DATABASE_URL;
  if (!sourceUrl || !targetUrl)
    throw new Error('Source read-only and dedicated backfill target database URLs are required.');
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmation = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
  if (apply && process.env.ORGANIZATION_BRANCH_BACKFILL_APPLY_ENABLED !== 'true') {
    throw new Error(
      'Apply is disabled. Set ORGANIZATION_BRANCH_BACKFILL_APPLY_ENABLED=true after review.',
    );
  }
  if (
    apply &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PRODUCTION_ORGANIZATION_BRANCH_BACKFILL !== 'true'
  ) {
    throw new Error(
      'Production apply requires ALLOW_PRODUCTION_ORGANIZATION_BRANCH_BACKFILL=true.',
    );
  }

  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  const target = new PrismaClient({ datasourceUrl: targetUrl });
  try {
    const read = await readLegacySnapshot(source);
    if (!read.snapshot) {
      console.info(
        JSON.stringify({
          mode: apply ? 'apply' : 'dry-run',
          status: 'requires_chunked_runbook',
          organizations: read.organizations,
          branches: read.branches,
          rowLimit: MAX_ROWS_FOR_SINGLE_TRANSACTION,
        }),
      );
      if (apply) throw new Error('Legacy data exceeds the reviewed single-transaction row limit.');
      return;
    }
    const snapshot = read.snapshot;
    const sourceHash = createHash('sha256').update(stableJson(snapshot)).digest('hex');
    const conflicts = countSourceConflicts(snapshot);
    await inspectTarget(target, snapshot, conflicts);
    const totalRows = read.organizations + read.branches;
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      sourceHash,
      organizations: snapshot.organizations.length,
      branches: snapshot.branches.length,
      conflicts,
      rowLimit: MAX_ROWS_FOR_SINGLE_TRANSACTION,
    };
    console.info(JSON.stringify(report));
    if (Object.values(conflicts).some((count) => count > 0)) {
      throw new Error('Backfill stopped: source or target consistency conflicts were found.');
    }
    if (!apply) return;
    if (totalRows > MAX_ROWS_FOR_SINGLE_TRANSACTION) {
      throw new Error(
        'Backfill exceeds the safe single-transaction row limit; use a reviewed chunked runbook.',
      );
    }
    if (confirmation !== sourceHash) {
      throw new Error('Apply requires --confirm=<sourceHash> printed by the reviewed dry-run.');
    }
    const result = await applySnapshot(target, snapshot, sourceHash);
    console.info(JSON.stringify(result));
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown backfill failure.';
  console.error(message);
  process.exitCode = 1;
});
