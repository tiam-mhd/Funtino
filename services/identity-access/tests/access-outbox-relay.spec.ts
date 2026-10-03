import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventTypes, type EventEnvelope } from '@funtino/event-contracts';
import type { EventBus } from '@funtino/backend-core';
import type { Prisma } from '../generated/prisma/index.js';
import { AccessOutboxRelayService } from '../src/infrastructure/messaging/outbox/access-outbox-relay.service.js';

const targetId = 'e29dd2b7-f356-44dc-9c15-49bb90dbb273';
const auditId = '35fc8fa0-70a6-4b10-a24a-6b60e81862ab';
const correlationId = 'dd817fc5-6d7b-4e63-b6e8-a6bd0da06f2d';
const leaseToken = 'fac30ea6-1c12-4b65-86d2-a02e01277e3a';

function validEvent(): EventEnvelope {
  return createEventEnvelope({
    eventType: eventTypes.identityPolicyChanged,
    sourceId: 'identity-access',
    aggregateId: targetId,
    correlationId,
    payload: {
      auditId,
      policyVersion: 3,
      changeType: 'role.updated',
      targetType: 'role',
      targetId,
    },
  });
}

function relayFor(input: {
  rows?: unknown[];
  publish?: (event: EventEnvelope) => Promise<void>;
  configured?: boolean;
}) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const published: EventEnvelope[] = [];
  let transactionCount = 0;
  const fakeTx = { $queryRaw: async () => input.rows ?? [] };
  const fakePrisma = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      return work(fakeTx);
    },
    outboxEvent: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;
  const eventBus: EventBus = {
    publish: async (event) => {
      published.push(event);
      await input.publish?.(event);
    },
    close: async () => undefined,
  };
  const prisma = fakePrisma as unknown as ConstructorParameters<typeof AccessOutboxRelayService>[0];
  const relay = new AccessOutboxRelayService(
    prisma,
    eventBus,
    input.configured ? 'amqp://local' : undefined,
  );

  return {
    relay,
    updates,
    published,
    get transactionCount() {
      return transactionCount;
    },
  };
}

test('publishes only a valid IAM event and acknowledges the matching lease', async () => {
  const event = validEvent();
  const { relay, updates, published } = relayFor({
    rows: [{ id: event.eventId, auditLogId: auditId, envelope: event, attempts: 0, leaseToken }],
    configured: true,
  });

  const result = await relay.flushOnce();

  assert.deepEqual(result, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });
  assert.equal(published[0]?.eventId, event.eventId);
  assert.deepEqual(updates[0]?.where, { id: event.eventId, leaseToken });
  assert.ok(updates[0]?.data.publishedAt instanceof Date);
  assert.equal(updates[0]?.data.leaseToken, null);
});

test('backs off transient publish errors without logging or persisting provider details', async () => {
  const event = validEvent();
  const { relay, updates } = relayFor({
    rows: [{ id: event.eventId, auditLogId: auditId, envelope: event, attempts: 2, leaseToken }],
    configured: true,
    publish: async () => {
      throw new Error('sensitive broker connection detail');
    },
  });

  const result = await relay.flushOnce();

  assert.equal(result.retried, 1);
  assert.deepEqual(updates[0]?.where, { id: event.eventId, leaseToken });
  assert.deepEqual(updates[0]?.data.attempts, { increment: 1 });
  assert.equal(updates[0]?.data.lastErrorCode, 'PUBLISH_FAILED');
  assert.ok(updates[0]?.data.availableAt instanceof Date);
  assert.equal(JSON.stringify(updates).includes('sensitive broker'), false);
});

test('dead-letters after the bounded retry limit', async () => {
  const event = validEvent();
  const { relay, updates } = relayFor({
    rows: [{ id: event.eventId, auditLogId: auditId, envelope: event, attempts: 11, leaseToken }],
    configured: true,
    publish: async () => {
      throw new Error('broker unavailable');
    },
  });

  const result = await relay.flushOnce();

  assert.equal(result.retried, 0);
  assert.equal(result.deadLettered, 1);
  assert.ok(updates[0]?.data.deadLetteredAt instanceof Date);
  assert.deepEqual(updates[0]?.data.attempts, { increment: 1 });
});

test('moves malformed envelopes to the service dead-letter state', async () => {
  const event = validEvent();
  const { relay, updates } = relayFor({
    rows: [
      {
        id: event.eventId,
        auditLogId: auditId,
        envelope: { ...event, payload: { ...event.payload, unexpected: 'value' } },
        attempts: 0,
        leaseToken,
      },
    ],
    configured: true,
  });

  const result = await relay.flushOnce();

  assert.equal(result.deadLettered, 1);
  assert.deepEqual(updates[0]?.where, { id: event.eventId, leaseToken });
  assert.equal(updates[0]?.data.lastErrorCode, 'INVALID_ENVELOPE');
  assert.ok(updates[0]?.data.deadLetteredAt instanceof Date);
});

test('does not claim or acknowledge events while RabbitMQ is unconfigured', async () => {
  const state = relayFor({ configured: false });

  const result = await state.relay.flushOnce();

  assert.equal(state.transactionCount, 0);
  assert.equal(result.claimed, 0);
});
