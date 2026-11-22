import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EdgeOperatorPairingService } from '../../src/application/edge-operator-pairing.service.js';
import type {
  EdgeOperatorPairingRecord,
  EdgeOperatorPairingRepository,
} from '../../src/application/ports/edge-operator-pairing.repository.js';

const sourceInstanceId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const managementSessionId = '55555555-5555-4555-8555-555555555555';
const correlationId = '66666666-6666-4666-8666-666666666666';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';
const permissions = ['customer.lookup.limited', 'card.assign'];

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function setup(rateLimitAllowed = true) {
  let record: EdgeOperatorPairingRecord | null = null;
  const repository = {
    createPending: async (
      input: Omit<
        EdgeOperatorPairingRecord,
        | 'status'
        | 'actorUserId'
        | 'managementSessionId'
        | 'permissionKeys'
        | 'approvalIdempotencyKey'
        | 'approvalRequestHash'
      >,
    ) => {
      record = {
        ...input,
        status: 'pending',
        actorUserId: null,
        managementSessionId: null,
        permissionKeys: null,
        approvalIdempotencyKey: null,
        approvalRequestHash: null,
      };
    },
    findById: async () => record,
    findByApprovalIdempotencyKey: async (key: string) =>
      record?.approvalIdempotencyKey === key ? record : null,
    consumeApprovalRateLimit: async () => rateLimitAllowed,
    approve: async (input: {
      pairingCodeHash: string;
      organizationId: string;
      branchId: string;
      actorUserId: string;
      managementSessionId: string;
      permissionKeys: string[];
      idempotencyKey: string;
      requestHash: string;
    }) => {
      if (
        !record ||
        record.status !== 'pending' ||
        record.pairingCodeHash !== input.pairingCodeHash ||
        record.organizationId !== input.organizationId ||
        record.branchId !== input.branchId
      )
        return null;
      record = {
        ...record,
        status: 'approved',
        actorUserId: input.actorUserId,
        managementSessionId: input.managementSessionId,
        permissionKeys: input.permissionKeys,
        approvalIdempotencyKey: input.idempotencyKey,
        approvalRequestHash: input.requestHash,
      };
      return record;
    },
    claim: async () => {
      if (!record || record.status !== 'approved') return null;
      record = { ...record, status: 'claimed' };
      return record;
    },
    markIssued: async () => {
      if (!record || record.status !== 'claimed') return false;
      record = { ...record, status: 'issued' };
      return true;
    },
    markFailed: async () => {
      if (record?.status === 'claimed') record = { ...record, status: 'failed' };
    },
    markExpired: async () => {
      if (record && ['pending', 'approved'].includes(record.status))
        record = { ...record, status: 'expired' };
    },
    cancel: async () => {
      if (!record || !['pending', 'approved'].includes(record.status)) return false;
      record = { ...record, status: 'cancelled' };
      return true;
    },
  } as unknown as EdgeOperatorPairingRepository;
  return { service: new EdgeOperatorPairingService(repository), getRecord: () => record };
}

test('pairing returns a short-lived one-time code while persistence contains only hashes', async () => {
  const { service, getRecord } = setup();
  const result = await service.start({ sourceInstanceId, organizationId, branchId });
  const stored = getRecord();
  assert.match(result.userCode, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/u);
  assert.match(result.pollSecret, /^[A-Za-z0-9_-]{40,}$/u);
  assert.equal(result.pollIntervalSeconds, 3);
  assert.ok(new Date(result.expiresAt).getTime() > Date.now());
  assert.equal(stored?.pairingCodeHash, hash(result.userCode.replace('-', '')));
  assert.equal(stored?.pollSecretHash, hash(result.pollSecret));
  assert.equal(JSON.stringify(stored).includes(result.userCode), false);
  assert.equal(JSON.stringify(stored).includes(result.pollSecret), false);
});

test('approval binds selected permissions, actor, session and branch, and replays only the same idempotent request', async () => {
  const { service, getRecord } = setup();
  const pairing = await service.start({ sourceInstanceId, organizationId, branchId });
  const input = {
    code: pairing.userCode.toLowerCase(),
    organizationId,
    branchId,
    actorUserId,
    managementSessionId,
    permissionKeys: permissions,
    idempotencyKey,
    correlationId,
  };
  const first = await service.approve(input);
  const replay = await service.approve(input);
  assert.deepEqual(first, {
    status: 'approved',
    branchId,
    permissionKeys: [...permissions].sort(),
    expiresAt: pairing.expiresAt,
  });
  assert.deepEqual(replay, first);
  assert.deepEqual(getRecord()?.permissionKeys, [...permissions].sort());
  await assert.rejects(
    service.approve({ ...input, permissionKeys: ['card.assign'] }),
    ConflictExceptionLike,
  );
});

test('concurrent duplicate approval replays the committed decision after the atomic code claim', async () => {
  const { service, getRecord } = setup();
  const pairing = await service.start({ sourceInstanceId, organizationId, branchId });
  const input = {
    code: pairing.userCode,
    organizationId,
    branchId,
    actorUserId,
    managementSessionId,
    permissionKeys: permissions,
    idempotencyKey,
    correlationId,
  };
  const [first, concurrentRetry] = await Promise.all([
    service.approve(input),
    service.approve(input),
  ]);
  assert.deepEqual(concurrentRetry, first);
  assert.equal(getRecord()?.approvalIdempotencyKey, idempotencyKey);
});

function ConflictExceptionLike(error: unknown) {
  return error instanceof HttpException && error.getStatus() === 409;
}

test('approval rejects a different branch and rate limits valid code attempts', async () => {
  const first = setup();
  const pairing = await first.service.start({ sourceInstanceId, organizationId, branchId });
  await assert.rejects(
    first.service.approve({
      code: pairing.userCode,
      organizationId,
      branchId: actorUserId,
      actorUserId,
      managementSessionId,
      permissionKeys: permissions,
      idempotencyKey,
      correlationId,
    }),
    (error: unknown) => error instanceof NotFoundException,
  );

  const limited = setup(false);
  const second = await limited.service.start({ sourceInstanceId, organizationId, branchId });
  await assert.rejects(
    limited.service.approve({
      code: second.userCode,
      organizationId,
      branchId,
      actorUserId,
      managementSessionId,
      permissionKeys: permissions,
      idempotencyKey,
      correlationId,
    }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );
});

test('poll secret is installation-bound and an approved pairing can be claimed only once', async () => {
  const { service } = setup();
  const start = await service.start({ sourceInstanceId, organizationId, branchId });
  await service.approve({
    code: start.userCode,
    organizationId,
    branchId,
    actorUserId,
    managementSessionId,
    permissionKeys: permissions,
    idempotencyKey,
    correlationId,
  });
  await assert.rejects(
    service.inspect({
      id: start.pairingId,
      sourceInstanceId: actorUserId,
      pollSecret: start.pollSecret,
    }),
    (error: unknown) => error instanceof NotFoundException,
  );
  await assert.rejects(
    service.inspect({
      id: start.pairingId,
      sourceInstanceId,
      pollSecret: 'wrong-secret'.padEnd(40, 'x'),
    }),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  const claimed = await service.claim({
    id: start.pairingId,
    sourceInstanceId,
    pollSecret: start.pollSecret,
  });
  assert.equal(claimed?.status, 'claimed');
  assert.equal(
    await service.claim({ id: start.pairingId, sourceInstanceId, pollSecret: start.pollSecret }),
    null,
  );
  assert.deepEqual(
    await service.inspect({ id: start.pairingId, sourceInstanceId, pollSecret: start.pollSecret }),
    { status: 'restart_required' },
  );
});
