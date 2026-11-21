import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eventEnvelopeSchema, eventTypes } from '@funtino/event-contracts';
import { EdgeSyncOperationsService } from '../../src/application/edge-sync-operations.service.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const sourceInstanceId = '33333333-3333-4333-8333-333333333333';
const cardId = '44444444-4444-4444-8444-444444444444';
const householdId = '55555555-5555-4555-8555-555555555555';
const eventId = '66666666-6666-4666-8666-666666666666';
const outboxEventId = '77777777-7777-4777-8777-777777777777';
const actorUserId = '88888888-8888-4888-8888-888888888888';
const correlationId = '99999999-9999-4999-8999-999999999999';
const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function validEnvelope() {
  return eventEnvelopeSchema.parse({
    eventId: outboxEventId,
    eventType: eventTypes.deviceEdgeTransactionImported,
    eventVersion: 1,
    occurredAt: '2026-11-18T10:00:00.000Z',
    organizationId,
    branchId,
    sourceId: 'device-integration',
    aggregateId: cardId,
    correlationId,
    causationId: null,
    payload: {
      eventId,
      sourceInstanceId,
      localTransactionId: 'local-transaction-17',
      sourceDatabase: 'funtino-local',
      organizationId,
      branchId,
      cardId,
      householdId,
      memberId: null,
      deviceId: null,
      sourceDeviceId: 'reader-01',
      attractionId: null,
      transactionKind: 'spend',
      amountRial: 100,
      currencyCode: 'IRR',
      grossAmountRial: 100,
      discountAmountRial: 0,
      netAmountRial: 100,
      promotionId: null,
      ruleId: null,
      pricingVersion: null,
      occurredAt: '2026-11-18T09:00:00.000Z',
      localSequence: 17,
      balanceAfterRial: 900,
      operationResult: 'success',
      snapshotVersion: 'edge-v2-17',
      reversalOfLocalTransactionId: null,
    },
  });
}

function baseRow() {
  return {
    id: outboxEventId,
    eventType: eventTypes.deviceEdgeTransactionImported,
    aggregateId: cardId,
    envelope: validEnvelope(),
    attempts: 8,
    publishedAt: null,
    deadLetteredAt: new Date('2026-11-18T10:10:00.000Z'),
    lastErrorCode: 'PUBLISH_FAILED',
  };
}

function input() {
  return {
    organizationId,
    branchId,
    eventId,
    reason: 'Reviewed failure and restored the connection',
    actorUserId,
    correlationId,
    idempotencyKey,
  };
}

function harness(options: { command?: unknown; rows?: unknown[] } = {}) {
  const calls: { update?: unknown; audit?: unknown; command?: unknown } = {};
  let queryCount = 0;
  const command = options.command ?? null;
  const tx = {
    idempotencyCommand: {
      findUnique: async () => command,
      create: async ({ data }: { data: unknown }) => {
        calls.command = data;
      },
    },
    $queryRaw: async () => {
      queryCount += 1;
      return options.rows ?? [baseRow()];
    },
    edgeInstallation: { findFirst: async () => ({ sourceInstanceId }) },
    outboxEvent: {
      updateMany: async ({ where, data }: { where: unknown; data: unknown }) => {
        calls.update = { where, data };
        return { count: 1 };
      },
    },
    edgeOutboxReplayAudit: {
      create: async ({ data }: { data: unknown }) => {
        calls.audit = data;
      },
    },
  };
  const prisma = {
    $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
    idempotencyCommand: { findUnique: async () => command },
  };
  return {
    service: new EdgeSyncOperationsService(prisma as unknown as PrismaService),
    calls,
    queryCount: () => queryCount,
  };
}

test('replay preserves event identity and payload while appending actor, reason and prior delivery state', async () => {
  const { service, calls } = harness();
  const result = await service.replayDeadLetter(input());
  assert.deepEqual(result, { eventId, status: 'queued_for_replay', outboxEventId });
  const update = calls.update as { where: { id: string }; data: Record<string, unknown> };
  assert.equal(update.where.id, outboxEventId);
  assert.equal(update.data.attempts, 0);
  assert.ok(update.data.availableAt instanceof Date);
  assert.equal(update.data.deadLetteredAt, null);
  assert.equal(update.data.leaseToken, null);
  assert.equal((calls.audit as { eventId: string }).eventId, eventId);
  assert.equal((calls.audit as { reason: string }).reason, input().reason);
  assert.equal((calls.audit as { actorUserId: string }).actorUserId, actorUserId);
  assert.equal((calls.audit as { previousAttempts: number }).previousAttempts, 8);
  assert.equal((calls.audit as { previousErrorCode: string }).previousErrorCode, 'PUBLISH_FAILED');
  assert.equal((calls.command as { key: string }).key, idempotencyKey);
});

test('an idempotent replay retry returns the original response without querying or resetting the outbox again', async () => {
  const response = { eventId, status: 'queued_for_replay' as const, outboxEventId };
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        organizationId,
        branchId,
        eventId,
        reason: input().reason,
      }),
    )
    .digest('hex');
  const { service, queryCount, calls } = harness({
    command: {
      requestHash,
      response,
    },
  });
  const result = await service.replayDeadLetter(input());
  assert.deepEqual(result, response);
  assert.equal(queryCount(), 0);
  assert.equal(calls.update, undefined);
});

test('replay rejects an event outside the requested branch and a row that is no longer dead-lettered', async () => {
  const missing = harness({ rows: [] });
  await assert.rejects(missing.service.replayDeadLetter(input()), NotFoundException);

  const published = harness({ rows: [{ ...baseRow(), publishedAt: new Date() }] });
  await assert.rejects(published.service.replayDeadLetter(input()), ConflictException);
  assert.equal(published.calls.update, undefined);
});
