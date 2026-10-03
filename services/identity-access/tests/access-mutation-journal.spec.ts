import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '../generated/prisma/index.js';
import { AccessMutationJournalService } from '../src/application/access-mutation-journal.service.js';

const actorUserId = '1a9ad0d5-ae30-42b8-989c-e9bf42fe40d9';
const organizationId = 'cfe4d287-9317-4a7d-b972-0ceca5a80e64';
const branchId = '8ee0f35a-1b05-4aab-99da-2b13e0c73fd9';
const targetId = 'e29dd2b7-f356-44dc-9c15-49bb90dbb273';
const correlationId = 'dd817fc5-6d7b-4e63-b6e8-a6bd0da06f2d';

test('records policy version, audit and outbox event through the caller transaction', async () => {
  const writes: Array<{ model: string; args: { data: Record<string, unknown> } }> = [];
  const tx = {
    policyState: {
      update: async (args: { data: { version: { increment: number } } }) => {
        assert.deepEqual(args.data.version, { increment: 1 });
        return { version: 8 };
      },
    },
    accessAuditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push({ model: 'audit', args });
        return args.data;
      },
    },
    outboxEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push({ model: 'outbox', args });
        return args.data;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await new AccessMutationJournalService().recordCommittedChange(tx, {
    actorUserId,
    changeType: 'role.created',
    targetType: 'role',
    targetId,
    scope: { type: 'branch', organizationId, branchId },
    reason: 'ایجاد نقش مدیر شعبه',
    correlationId,
    afterState: {
      kind: 'role',
      id: targetId,
      name: 'مدیر شعبه',
      status: 'active',
      scope: { type: 'branch', organizationId, branchId },
      systemManaged: false,
      version: 1,
      permissionKeys: ['access.role.read'],
    },
  });

  assert.equal(result.policyVersion, 8);
  assert.deepEqual(
    writes.map(({ model }) => model),
    ['audit', 'outbox'],
  );
  assert.equal(writes[0]?.args.data.id, result.auditId);
  assert.equal(writes[0]?.args.data.policyVersion, 8);
  assert.equal(writes[0]?.args.data.scopeType, 'branch');
  assert.equal(writes[0]?.args.data.reason, 'ایجاد نقش مدیر شعبه');

  const outbox = writes[1]?.args.data;
  assert.equal(outbox?.id, result.eventId);
  assert.equal(outbox?.auditLogId, result.auditId);
  assert.equal(outbox?.eventType, 'identity.access-policy-changed.v1');
  assert.deepEqual((outbox?.envelope as { payload: unknown }).payload, {
    auditId: result.auditId,
    policyVersion: 8,
    changeType: 'role.created',
    targetType: 'role',
    targetId,
  });
});

test('records authorized sensitive reads without changing policy version or creating an outbox event', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const tx = {
    accessAuditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        return { id: 'a791b641-e825-47e1-99c2-e8bc5f340a67' };
      },
    },
    policyState: { update: async () => assert.fail('read auditing must not change policy version') },
    outboxEvent: { create: async () => assert.fail('read auditing must not emit mutation events') },
  } as unknown as Prisma.TransactionClient;

  const result = await new AccessMutationJournalService().recordSensitiveAccess(tx, {
    actorUserId,
    action: 'staff.read',
    targetType: 'membership',
    targetId,
    scope: { type: 'organization', organizationId },
    reason: 'Manager viewed staff records.',
    correlationId,
    policyVersion: 8,
  });

  assert.equal(result.auditId, 'a791b641-e825-47e1-99c2-e8bc5f340a67');
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.outcome, 'succeeded');
  assert.equal(writes[0]?.policyVersion, 8);
  assert.equal(writes[0]?.action, 'staff.read');
});

test('rejects a change without a meaningful reason before writing audit or outbox', async () => {
  const tx = {
    policyState: { update: async () => assert.fail('policy version must not change') },
    accessAuditLog: { create: async () => assert.fail('audit must not be written') },
    outboxEvent: { create: async () => assert.fail('outbox must not be written') },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    () =>
      new AccessMutationJournalService().recordCommittedChange(tx, {
        actorUserId,
        changeType: 'role.created',
        targetType: 'role',
        targetId,
        scope: { type: 'organization', organizationId },
        reason: '  ',
        correlationId,
      }),
    /Invalid access change audit context/,
  );
});

test('rejects audit snapshots containing unapproved fields or personal contact data', async () => {
  const tx = {
    policyState: { update: async () => assert.fail('policy version must not change') },
    accessAuditLog: { create: async () => assert.fail('audit must not be written') },
    outboxEvent: { create: async () => assert.fail('outbox must not be written') },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    () =>
      new AccessMutationJournalService().recordCommittedChange(tx, {
        actorUserId,
        changeType: 'role.created',
        targetType: 'role',
        targetId,
        scope: { type: 'organization', organizationId },
        reason: 'ایجاد نقش مجاز',
        correlationId,
        afterState: {
          kind: 'role',
          id: targetId,
          name: 'مدیر سازمان',
          status: 'active',
          scope: { type: 'organization', organizationId },
          systemManaged: false,
          version: 1,
          permissionKeys: [],
          email: 'person@example.invalid',
        } as never,
      }),
    /Invalid access change audit snapshot/,
  );
});
