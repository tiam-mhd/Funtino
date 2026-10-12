import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { AccessPolicyService } from '../src/application/access-policy.service.js';
import { permissionCatalogVersion } from '../src/domain/authorization/permission-catalog.js';
import type { AccessMutationJournalService } from '../src/application/access-mutation-journal.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = 'org-a';
const branchId = 'branch-a';
const userId = 'user-a';

function makeMembership(input: {
  id: string;
  status?: 'active' | 'pending' | 'suspended' | 'revoked';
  organizationId?: string | null;
  branchId?: string | null;
  permissionKeys: string[];
  overrides?: Array<{
    id: string;
    membershipId: string;
    permissionKey: string;
    effect: 'allow' | 'deny';
    scopeType: 'global' | 'organization' | 'branch';
    organizationId: string | null;
    branchId: string | null;
    startsAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    resourceType: string | null;
    resourceId: string | null;
  }>;
}) {
  const scopeType = input.branchId ? 'branch' : input.organizationId ? 'organization' : 'global';
  return {
    id: input.id,
    userId,
    status: input.status ?? 'active',
    scopeType,
    organizationId: input.organizationId ?? null,
    branchId: input.branchId ?? null,
    role: {
      id: `role-${input.id}`,
      name: 'Test role',
      scopeType,
      organizationId: input.organizationId ?? null,
      branchId: input.branchId ?? null,
      status: 'active',
      systemManaged: false,
      version: 1,
      permissions: input.permissionKeys.map((permissionKey) => ({ permissionKey })),
    },
    overrides: input.overrides ?? [],
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeRole(input: {
  id: string;
  scopeType: 'global' | 'organization' | 'branch';
  organizationId: string | null;
  branchId: string | null;
}) {
  return {
    ...input,
    name: `Role ${input.id}`,
    status: 'active' as const,
    systemManaged: false,
    version: 1,
    permissions: [{ permissionKey: 'access.role.read' }],
  };
}

function makeService(
  memberships: ReturnType<typeof makeMembership>[],
  roles: ReturnType<typeof makeRole>[] = [],
  credential: { status: 'active' | 'disabled'; version: number } | null = null,
  journalOverrides: Partial<
    Pick<AccessMutationJournalService, 'recordSensitiveAccess' | 'recordDeniedAttempt'>
  > = {},
) {
  const tx = {
    staffMembership: {
      findMany: async () => memberships,
    },
    policyState: {
      findUnique: async () => ({ id: 1, version: 7, updatedAt: new Date() }),
    },
    accessRole: {
      findMany: async () => roles,
    },
    mfaCredential: {
      findUnique: async () => credential,
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
  } as unknown as PrismaService;
  const journal = {
    recordSensitiveAccess: async () => ({ auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    recordDeniedAttempt: async () => ({ auditId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    ...journalOverrides,
  } as unknown as AccessMutationJournalService;
  return new AccessPolicyService(prisma, journal);
}

test('database-backed evaluator grants a role permission only within its organization scope', async () => {
  const service = makeService([
    makeMembership({ id: 'membership-a', organizationId, permissionKeys: ['staff.read'] }),
  ]);

  const allowed = await service.evaluate(userId, {
    permission: 'staff.read',
    scope: { type: 'branch', organizationId, branchId },
  });
  const denied = await service.evaluate(userId, {
    permission: 'staff.read',
    scope: { type: 'organization', organizationId: 'org-b' },
  });

  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(allowed.policyVersion, 7);
});

test('an explicit membership deny overrides a role grant across applicable memberships', async () => {
  const service = makeService([
    makeMembership({ id: 'membership-org', organizationId, permissionKeys: ['staff.read'] }),
    makeMembership({
      id: 'membership-branch',
      organizationId,
      branchId,
      permissionKeys: ['staff.read'],
      overrides: [
        {
          id: 'override-deny',
          membershipId: 'membership-branch',
          permissionKey: 'staff.read',
          effect: 'deny',
          scopeType: 'branch',
          organizationId,
          branchId,
          startsAt: new Date('2000-01-01T00:00:00.000Z'),
          expiresAt: null,
          revokedAt: null,
          resourceType: null,
          resourceId: null,
        },
      ],
    }),
  ]);

  const result = await service.evaluate(userId, {
    permission: 'staff.read',
    scope: { type: 'branch', organizationId, branchId },
  });
  assert.equal(result.allowed, false);
});

test('step-up permissions remain denied without fresh session MFA evidence', async () => {
  const service = makeService([
    makeMembership({ id: 'membership-a', organizationId, permissionKeys: ['card.assign'] }),
  ]);

  const result = await service.evaluate(userId, {
    permission: 'card.assign',
    scope: { type: 'organization', organizationId },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'step_up_required');
});

test('fresh session evidence grants a step-up permission only for the current active factor version', async () => {
  const membership = makeMembership({
    id: 'membership-step-up',
    organizationId,
    permissionKeys: ['card.assign'],
  });
  const evidence = {
    verifiedAt: new Date(),
    factorVersion: 3,
    method: 'totp' as const,
  };
  const request = {
    permission: 'card.assign',
    scope: { type: 'organization' as const, organizationId },
  };

  const matching = makeService([membership], [], { status: 'active', version: 3 });
  assert.equal((await matching.evaluate(userId, request, evidence)).allowed, true);

  const rotated = makeService([membership], [], { status: 'active', version: 4 });
  assert.equal((await rotated.evaluate(userId, request, evidence)).allowed, false);

  const disabled = makeService([membership], [], { status: 'disabled', version: 3 });
  assert.equal((await disabled.evaluate(userId, request, evidence)).allowed, false);
});

test('MFA step-up expires after five minutes even when its factor version is current', async () => {
  const service = makeService(
    [makeMembership({ id: 'membership-expired', organizationId, permissionKeys: ['card.assign'] })],
    [],
    { status: 'active', version: 2 },
  );
  const result = await service.evaluate(
    userId,
    { permission: 'card.assign', scope: { type: 'organization', organizationId } },
    { verifiedAt: new Date(Date.now() - 300_001), factorVersion: 2, method: 'recovery' },
  );
  assert.equal(result.allowed, false);
});

test('role queries require an active read grant in the requested tenant scope', async () => {
  const service = makeService([
    makeMembership({ id: 'membership-a', organizationId, permissionKeys: ['staff.read'] }),
  ]);

  await assert.rejects(
    service.listRoles(userId, organizationId),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('role listings are scope-filtered and return a bounded keyset page', async () => {
  const service = makeService(
    [
      makeMembership({
        id: 'membership-a',
        organizationId,
        permissionKeys: ['access.role.read'],
      }),
    ],
    [
      makeRole({
        id: '00000000-0000-4000-8000-000000000001',
        scopeType: 'organization',
        organizationId,
        branchId: null,
      }),
      makeRole({
        id: '00000000-0000-4000-8000-000000000002',
        scopeType: 'organization',
        organizationId,
        branchId: null,
      }),
    ],
  );

  const result = await service.listRoles(userId, organizationId, undefined, { pageSize: 1 });
  assert.equal(result.data.length, 1);
  assert.equal(result.nextCursor, '00000000-0000-4000-8000-000000000001');
});

test('role reads audit successful listings and denied template access', async () => {
  let sensitiveReadCount = 0;
  let deniedAttemptCount = 0;
  const journalSpy = {
    recordSensitiveAccess: async () => {
      sensitiveReadCount += 1;
      return { auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    },
    recordDeniedAttempt: async () => {
      deniedAttemptCount += 1;
      return { auditId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    },
  };
  const service = makeService(
    [makeMembership({ id: 'membership-a', organizationId, permissionKeys: ['access.role.read'] })],
    [],
    null,
    journalSpy,
  );
  const deniedService = makeService([], [], null, journalSpy);

  await service.listRolesInScope(userId, { type: 'organization', organizationId });
  await assert.rejects(
    deniedService.roleTemplates(userId, { type: 'organization', organizationId }),
    (error: unknown) => error instanceof ForbiddenException,
  );

  assert.equal(sensitiveReadCount, 1);
  assert.equal(deniedAttemptCount, 1);
});

test('current membership projection returns scope-safe summaries and policy versions', async () => {
  const service = makeService([
    makeMembership({ id: 'membership-a', organizationId, permissionKeys: ['access.role.read'] }),
  ]);

  const result = await service.currentMemberships(userId);
  assert.equal(result.policyVersion, 7);
  assert.equal(result.catalogVersion, permissionCatalogVersion);
  assert.equal(result.data[0]?.id, 'membership-a');
  assert.equal(result.data[0]?.role.permissionKeys[0], 'access.role.read');
  assert.equal('userId' in (result.data[0] ?? {}), false);
});
