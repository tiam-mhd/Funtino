import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EdgeOperatorTokenService } from '../src/application/edge-operator-token.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';
import type { AccessPolicyService } from '../src/application/access-policy.service.js';
import type { OrganizationScopeOwner } from '../src/application/ports/organization-scope-owner.port.js';

const actorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const organizationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const branchId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const correlationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

type TokenRecord = {
  id: string;
  tokenHash: string;
  actorUserId: string;
  sessionId: string;
  organizationId: string;
  branchId: string;
  permissionKeys: unknown;
  policyVersion: number;
  catalogVersion: number;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
};

function makeService(options: { allowed?: boolean } = {}) {
  let allowed = options.allowed ?? true;
  let tokenRecord: TokenRecord | null = null;
  const audits: Array<Record<string, unknown>> = [];
  const tx = {
    edgeOperatorToken: {
      create: async ({ data }: { data: TokenRecord }) => {
        tokenRecord = data;
        return data;
      },
      findMany: async () => (tokenRecord ? [tokenRecord] : []),
      updateMany: async ({ data }: { data: Partial<TokenRecord> }) => {
        if (tokenRecord) tokenRecord = { ...tokenRecord, ...data };
        return { count: tokenRecord ? 1 : 0 };
      },
    },
    edgeOperatorTokenAudit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        audits.push(...data);
        return { count: data.length };
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
    edgeOperatorToken: {
      findUnique: async () => tokenRecord,
      updateMany: tx.edgeOperatorToken.updateMany,
    },
  } as unknown as PrismaService;
  const accessPolicy = {
    evaluate: async () => ({ allowed, policyVersion: 7, catalogVersion: 7 }),
  } as unknown as AccessPolicyService;
  const organizationScopeOwner = {
    validateScope: async () => ({ valid: true, organizationId, branchId }),
  } as unknown as OrganizationScopeOwner;
  return {
    service: new EdgeOperatorTokenService(prisma, accessPolicy, organizationScopeOwner),
    readToken: () => tokenRecord,
    audits,
    setAllowed: (value: boolean) => {
      allowed = value;
    },
  };
}

test('operator token is opaque, branch scoped, short lived and only its hash is stored', async () => {
  const { service, readToken, audits } = makeService();
  const issued = await service.issue({
    actorUserId,
    sessionId,
    scope: { type: 'branch', organizationId, branchId },
    permissionKeys: ['customer.family.read', 'card.assign'],
    correlationId,
  });
  const stored = readToken();
  assert.ok(stored);
  assert.equal(stored.tokenHash, createHash('sha256').update(issued.token).digest('hex'));
  assert.equal('token' in stored, false);
  assert.deepEqual(issued.permissionKeys, ['card.assign', 'customer.family.read']);
  assert.equal(Date.parse(issued.expiresAt) - Date.parse(stored.issuedAt.toISOString()), 300_000);
  assert.equal(stored.branchId, branchId);
  assert.equal(audits[0]?.action, 'issued');

  const validated = await service.validate({
    token: issued.token,
    branchId,
    permission: 'card.assign',
  });
  assert.equal(validated.actorUserId, actorUserId);
  assert.equal(validated.branchId, branchId);
});

test('operator token rejects a different branch and rechecks current IAM permission', async () => {
  const { service, setAllowed } = makeService();
  const issued = await service.issue({
    actorUserId,
    sessionId,
    scope: { type: 'branch', organizationId, branchId },
    permissionKeys: ['card.assign'],
    correlationId,
  });
  await assert.rejects(
    service.validate({
      token: issued.token,
      branchId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      permission: 'card.assign',
    }),
    (error: unknown) => error instanceof UnauthorizedException,
  );

  setAllowed(false);
  await assert.rejects(
    service.validate({ token: issued.token, branchId, permission: 'card.assign' }),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('management session revocation records an audit event and revokes its active tokens', async () => {
  const { service, audits } = makeService();
  const issued = await service.issue({
    actorUserId,
    sessionId,
    scope: { type: 'branch', organizationId, branchId },
    permissionKeys: ['card.assign'],
    correlationId,
  });
  const result = await service.revokeSession({ actorUserId, sessionId, correlationId });
  assert.equal(result.revokedCount, 1);
  assert.equal(audits.at(-1)?.action, 'revoked');
  await assert.rejects(
    service.validate({ token: issued.token, branchId, permission: 'card.assign' }),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});
