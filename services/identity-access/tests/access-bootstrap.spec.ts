import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { AccessBootstrapService } from '../src/bootstrap/access-bootstrap.service.js';
import {
  BOOTSTRAP_MEMBERSHIP_TTL_MS,
  SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
} from '../src/domain/authorization/bootstrap-membership.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';
import type { AccessMutationJournalService } from '../src/application/access-mutation-journal.service.js';
import type { MfaService } from '../src/application/mfa.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const roleId = '22222222-2222-4222-8222-222222222222';
const bootstrapRole = {
  id: roleId,
  name: SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
  scopeType: 'global',
  organizationId: null,
  branchId: null,
  systemManaged: true,
  status: 'active',
  version: 1,
  permissions: [{ permissionKey: 'system.access.bootstrap' }],
};

function serviceFixture(occupiedCreatedAt: Date | null) {
  const expiredMembershipId = '33333333-3333-4333-8333-333333333333';
  const mutations: string[] = [];
  const tx = {
    $queryRaw: async () => [{ id: 1 }],
    accessRole: {
      findFirst: async ({ where }: { where: { name: string } }) =>
        where.name === SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME ? bootstrapRole : null,
    },
    staffMembership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const roleFilter = where.role as { is?: { name?: string } } | undefined;
        if (roleFilter?.is?.name === 'system_admin') return null;
        if (where.userId === userId) return null;
        return null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.roleId === roleId && occupiedCreatedAt) {
          return [
            {
              id: expiredMembershipId,
              userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              roleId,
              status: 'active',
              version: 1,
              createdAt: occupiedCreatedAt,
            },
          ];
        }
        return [];
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string; version: { increment: number } };
      }) => {
        mutations.push(`revoke:${where.id}`);
        return {
          id: where.id,
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          roleId,
          status: data.status,
          version: 2,
          createdAt: occupiedCreatedAt!,
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        mutations.push('create');
        return { ...data, createdAt: new Date() };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
    staffMembership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.userId !== userId) return null;
        return {
          id: expiredMembershipId,
          userId,
          roleId,
          scopeType: 'global',
          status: 'active',
          version: 1,
          createdAt: new Date(Date.now() - BOOTSTRAP_MEMBERSHIP_TTL_MS - 1),
          role: bootstrapRole,
        };
      },
    },
  } as unknown as PrismaService;
  const journal = {
    recordCommittedChange: async (_tx: unknown, input: { changeType: string }) => {
      mutations.push(input.changeType);
      return { auditId: '44444444-4444-4444-8444-444444444444' };
    },
  } as unknown as AccessMutationJournalService;
  let mfaVerifications = 0;
  const mfa = {
    verifyStepUp: async () => {
      mfaVerifications += 1;
      return { factorVersion: 1 };
    },
  } as unknown as MfaService;
  return {
    service: new AccessBootstrapService(prisma, journal, mfa),
    mutations,
    get mfaVerifications() {
      return mfaVerifications;
    },
  };
}

test('prepare revokes an expired bootstrap lease with audit before creating a new one', async () => {
  const expiredAt = new Date(Date.now() - BOOTSTRAP_MEMBERSHIP_TTL_MS - 1);
  const fixture = serviceFixture(expiredAt);
  const result = await fixture.service.prepare({
    userId,
    operatorLabel: 'change-1234',
    reason: 'Prepare the initial system administrator.',
  });

  assert.equal(result.status, 'prepared');
  assert.equal(Date.parse(result.expiresAt) > Date.now(), true);
  assert.deepEqual(fixture.mutations, [
    'revoke:33333333-3333-4333-8333-333333333333',
    'membership.revoked',
    'create',
    'membership.activated',
  ]);
});

test('finalize rejects an expired bootstrap before consuming an MFA proof', async () => {
  const fixture = serviceFixture(null);
  await assert.rejects(
    fixture.service.finalize({
      userId,
      operatorLabel: 'change-1234',
      reason: 'Finalize the initial system administrator.',
      code: '123456',
      method: 'totp',
    }),
    ConflictException,
  );
  assert.equal(fixture.mfaVerifications, 0);
});
