import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { CardLifecycleRequestService } from '../../src/application/card-lifecycle-request.service.js';

const cardId = '11111111-1111-4111-8111-111111111111';
const householdId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const organizationId = '44444444-4444-4444-8444-444444444444';
const actorUserId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';
const correlationId = '77777777-7777-4777-8777-777777777777';

test('Edge lifecycle request rejects a stale expected card version in a serializable transaction', async () => {
  let isolationLevel: unknown;
  let wroteRequest = false;
  const transaction = {
    cardAssignment: {
      findFirst: async () => ({
        id: '88888888-8888-4888-8888-888888888888',
        cardId,
        organizationId,
        branchId,
        householdId,
        memberId: null,
        assignedAt: new Date('2026-11-20T00:00:00.000Z'),
        card: { status: 'assigned', verificationStatus: 'verified', version: 6 },
      }),
    },
    cardLifecycleRequest: {
      findFirst: async () => null,
      create: async () => {
        wroteRequest = true;
        throw new Error('unexpected write');
      },
    },
    cardLifecycleRequestHistory: {
      create: async () => {
        throw new Error('unexpected history');
      },
    },
    outboxEvent: {
      create: async () => {
        throw new Error('unexpected outbox write');
      },
    },
  };
  const prisma = {
    cardLifecycleRequest: { findUnique: async () => null },
    $transaction: async (
      callback: (tx: typeof transaction) => Promise<unknown>,
      options: unknown,
    ) => {
      isolationLevel = options;
      return callback(transaction);
    },
  };
  const service = new CardLifecycleRequestService(prisma as never, {} as never, {} as never);

  await assert.rejects(
    () =>
      service.createRequest({
        householdId,
        cardId,
        action: 'replacement',
        expectedVersion: 5,
        reason: 'Card chip stopped responding',
        requesterId: actorUserId,
        correlationId,
        idempotencyKey,
        requesterType: 'operations',
      }),
    ConflictException,
  );
  assert.deepEqual(isolationLevel, { isolationLevel: 'Serializable' });
  assert.equal(wroteRequest, false);
});
