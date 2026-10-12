import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  branchInputSchema,
  organizationInputSchema,
  statusInputSchema,
  OrganizationBranchService,
} from '../src/application/organization-branch.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '11111111-1111-4111-8111-111111111111';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

function createFakePrisma() {
  const organizations = new Map<string, Record<string, unknown>>();
  const branches = new Map<string, Record<string, unknown>>();
  const idempotency = new Map<string, Record<string, unknown>>();
  const writes = { organizations: 0, audits: 0, events: 0 };
  const transaction = {
    organization: {
      findMany: async ({ where, take }: { where?: { id?: { gt: string } }; take: number }) =>
        [...organizations.values()]
          .filter((row) => !where?.id || String(row.id) > where.id.gt)
          .sort((left, right) => String(left.id).localeCompare(String(right.id)))
          .slice(0, take),
      findUnique: async ({ where }: { where: { id: string } }) =>
        organizations.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = organizations.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row = {
          id: randomUUID(),
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        organizations.set(String(row.id), row);
        writes.organizations += 1;
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; version: number };
        data: Record<string, unknown>;
      }) => {
        const row = organizations.get(where.id);
        if (!row || row.version !== where.version) return { count: 0 };
        const increment = data.version as { increment: number } | undefined;
        Object.assign(row, data, {
          version: Number(row.version) + (increment?.increment ?? 0),
          updatedAt: new Date(),
        });
        organizations.set(where.id, row);
        return { count: 1 };
      },
    },
    branch: {
      findMany: async ({
        where,
        take,
      }: {
        where: {
          organizationId?: string;
          id?: { gt: string };
          status?: string;
          organization?: { status: string };
        };
        take: number;
      }) =>
        [...branches.values()]
          .filter((row) => !where.organizationId || row.organizationId === where.organizationId)
          .filter((row) => !where.status || row.status === where.status)
          .filter((row) => !where.id || String(row.id) > where.id.gt)
          .filter(
            (row) => !where.organization || row.organizationStatus === where.organization.status,
          )
          .sort((left, right) => String(left.id).localeCompare(String(right.id)))
          .slice(0, take),
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string; status: string };
      }) => {
        const row = branches.get(where.id);
        return row?.organizationId === where.organizationId && row.status === where.status
          ? row
          : null;
      },
    },
    idempotencyCommand: {
      findUnique: async ({
        where,
      }: {
        where: { callerService_key: { callerService: string; key: string } };
      }) =>
        idempotency.get(
          `${where.callerService_key.callerService}:${where.callerService_key.key}`,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        idempotency.set(`${data.callerService}:${data.key}`, data);
        return data;
      },
    },
    auditLog: {
      create: async () => {
        writes.audits += 1;
        return {};
      },
    },
    outboxEvent: {
      create: async () => {
        writes.events += 1;
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async <T>(work: (tx: typeof transaction) => Promise<T>) => work(transaction),
    ...transaction,
  };
  return { prisma: prisma as unknown as PrismaService, organizations, branches, writes };
}

const meta = {
  callerService: 'api-gateway' as const,
  idempotencyKey,
  actorUserId,
  correlationId,
};

test('organization creation is atomic with one audit/event and idempotent replay', async () => {
  const fake = createFakePrisma();
  const service = new OrganizationBranchService(fake.prisma);
  const input = {
    name: 'Funtino',
    slug: 'funtino',
    timezone: 'Asia/Tehran',
    reason: 'Initial organization setup',
  };

  const created = await service.createOrganization(input, meta);
  const replay = await service.createOrganization(input, meta);

  assert.deepEqual(replay, created);
  assert.equal(fake.writes.organizations, 1);
  assert.equal(fake.writes.audits, 1);
  assert.equal(fake.writes.events, 1);
});

test('an idempotency key cannot be reused for a different organization command', async () => {
  const fake = createFakePrisma();
  const service = new OrganizationBranchService(fake.prisma);
  await service.createOrganization(
    {
      name: 'Funtino',
      slug: 'funtino',
      timezone: 'Asia/Tehran',
      reason: 'Initial organization setup',
    },
    meta,
  );

  await assert.rejects(
    service.createOrganization(
      {
        name: 'Different Name',
        slug: 'different-name',
        timezone: 'Asia/Tehran',
        reason: 'Initial organization setup',
      },
      meta,
    ),
    (error: unknown) => error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(fake.writes.organizations, 1);
});

test('organization status transitions enforce optimistic version and terminal archive', async () => {
  const fake = createFakePrisma();
  const service = new OrganizationBranchService(fake.prisma);
  fake.organizations.set(organizationId, {
    id: organizationId,
    name: 'Funtino',
    slug: 'funtino',
    timezone: 'Asia/Tehran',
    status: 'active',
    version: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await assert.rejects(
    service.changeOrganizationStatus(
      organizationId,
      2,
      {
        status: 'suspended',
        reason: 'Temporary operational pause',
      },
      { ...meta, idempotencyKey: randomUUID() },
    ),
    (error: unknown) => error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(fake.organizations.get(organizationId)?.status, 'active');

  fake.organizations.get(organizationId)!.status = 'archived';
  await assert.rejects(
    service.changeOrganizationStatus(
      organizationId,
      3,
      {
        status: 'active',
        reason: 'Attempt forbidden restoration',
      },
      { ...meta, idempotencyKey: randomUUID() },
    ),
    (error: unknown) => error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(fake.writes.audits, 0);
  assert.equal(fake.writes.events, 0);
});

test('scope validation requires an active organization and a branch under that exact parent', async () => {
  const fake = createFakePrisma();
  const service = new OrganizationBranchService(fake.prisma);
  fake.organizations.set(organizationId, {
    id: organizationId,
    name: 'Funtino',
    slug: 'funtino',
    timezone: 'Asia/Tehran',
    status: 'active',
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const branchId = '44444444-4444-4444-8444-444444444444';
  fake.branches.set(branchId, {
    id: branchId,
    organizationId,
    status: 'active',
    version: 4,
  });

  assert.deepEqual(await service.validateScope({ type: 'organization', organizationId }), {
    valid: true,
    organizationId,
    organizationVersion: 2,
  });
  assert.deepEqual(await service.validateScope({ type: 'branch', organizationId, branchId }), {
    valid: true,
    organizationId,
    branchId,
    organizationVersion: 2,
    branchVersion: 4,
  });
  assert.deepEqual(
    await service.validateScope({
      type: 'branch',
      organizationId: '66666666-6666-4666-8666-666666666666',
      branchId,
    }),
    { valid: false, reason: 'organization_unavailable' },
  );
});

test('organization and branch inputs reject invalid timezone and unsupported weekday keys', () => {
  assert.equal(
    organizationInputSchema.safeParse({
      name: 'Funtino',
      slug: 'funtino',
      timezone: 'Not/A_Timezone',
      reason: 'Initial setup reason',
    }).success,
    false,
  );
  assert.equal(
    branchInputSchema.safeParse({
      name: 'North Branch',
      slug: 'north-branch',
      address: 'Main road',
      city: 'Tehran',
      timezone: 'Asia/Tehran',
      openingHours: { someday: null },
      reason: 'Initial setup reason',
    }).success,
    false,
  );
});

test('system organization and branch mutations allow an omitted reason but terminal archive requires one', () => {
  assert.equal(
    organizationInputSchema.safeParse({
      name: 'Funtino',
      slug: 'funtino',
      timezone: 'Asia/Tehran',
    }).success,
    true,
  );
  assert.equal(statusInputSchema.safeParse({ status: 'suspended' }).success, true);
  assert.equal(statusInputSchema.safeParse({ status: 'archived' }).success, false);
  assert.equal(
    statusInputSchema.safeParse({ status: 'archived', reason: 'Approved terminal archive' })
      .success,
    true,
  );
});

test('organization and branch listings use exclusive keyset cursors and bounded page sizes', async () => {
  const fake = createFakePrisma();
  const service = new OrganizationBranchService(fake.prisma);
  const organizationIds = [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
  ];
  for (const id of organizationIds) {
    fake.organizations.set(id, {
      id,
      name: 'Funtino',
      slug: `funtino-${id.slice(-1)}`,
      timezone: 'Asia/Tehran',
      status: 'active',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const firstOrganizations = await service.listOrganizations({ pageSize: 2 });
  const secondOrganizations = await service.listOrganizations({
    pageSize: 2,
    cursor: firstOrganizations.nextCursor ?? undefined,
  });
  assert.deepEqual(
    firstOrganizations.items.map((item) => item.id),
    organizationIds.slice(0, 2),
  );
  assert.equal(firstOrganizations.nextCursor, organizationIds[1]);
  assert.deepEqual(
    secondOrganizations.items.map((item) => item.id),
    organizationIds.slice(2),
  );
  assert.equal(secondOrganizations.nextCursor, null);

  const branchIds = [
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
  ];
  branchIds.forEach((id, index) => {
    fake.branches.set(id, {
      id,
      organizationId: index === 2 ? organizationIds[1] : organizationIds[0],
      name: 'Branch',
      slug: `branch-${index}`,
      address: 'Main road',
      city: 'Tehran',
      timezone: 'Asia/Tehran',
      status: 'active',
      openingHours: { saturday: null },
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  const firstBranches = await service.listBranches({
    organizationId: organizationIds[0],
    pageSize: 1,
  });
  const secondBranches = await service.listBranches({
    organizationId: organizationIds[0],
    pageSize: 1,
    cursor: firstBranches.nextCursor ?? undefined,
  });
  assert.deepEqual(
    firstBranches.items.map((item) => item.id),
    branchIds.slice(0, 1),
  );
  assert.equal(firstBranches.nextCursor, branchIds[0]);
  assert.deepEqual(
    secondBranches.items.map((item) => item.id),
    branchIds.slice(1, 2),
  );
  assert.equal(secondBranches.nextCursor, null);

  await assert.rejects(
    service.listBranches({
      organizationId: '99999999-9999-4999-8999-999999999999',
      pageSize: 25,
    }),
    (error: unknown) => error instanceof NotFoundException,
  );
});
