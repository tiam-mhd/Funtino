import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import type { EventBus } from '@funtino/backend-core';
import { OrganizationBranchOutboxRelayService } from '../src/infrastructure/messaging/outbox/organization-branch-outbox-relay.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = '33333333-3333-4333-8333-333333333333';
const correlationId = '55555555-5555-4555-8555-555555555555';

function relayFor(envelope: unknown, overrides: Record<string, unknown> = {}) {
  let published = 0;
  let updated: Record<string, unknown> | undefined;
  const parsed = envelope as { eventId: string; eventType: string; aggregateId: string };
  const row = {
    id: parsed.eventId,
    eventType: parsed.eventType,
    aggregateId: parsed.aggregateId,
    envelope,
    attempts: 0,
    leaseToken: '77777777-7777-4777-8777-777777777777',
    ...overrides,
  };
  const prisma = {
    $transaction: async <T>(work: (tx: { $queryRaw: () => Promise<unknown[]> }) => Promise<T>) =>
      work({ $queryRaw: async () => [row] }),
    outboxEvent: {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        updated = args.data;
        return { count: 1 };
      },
    },
  };
  const eventBus: EventBus = {
    publish: async () => {
      published += 1;
    },
    close: async () => {},
  };
  const relay = new OrganizationBranchOutboxRelayService(
    prisma as unknown as PrismaService,
    eventBus,
    'amqp://localhost',
  );
  return { relay, published: () => published, updated: () => updated };
}

function validEvent() {
  return createEventEnvelope({
    eventType: eventTypes.organizationCreated,
    sourceId: 'organization-branch',
    aggregateId: organizationId,
    correlationId,
    organizationId,
    payload: {
      id: organizationId,
      name: 'Funtino',
      slug: 'funtino',
      timezone: 'Asia/Tehran',
      status: 'active',
      version: 1,
    },
  });
}

test('outbox relay publishes a valid owner event and acknowledges it with the lease token', async () => {
  const event = validEvent();
  const testRelay = relayFor(event);
  const result = await testRelay.relay.flushOnce();
  assert.deepEqual(result, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });
  assert.equal(testRelay.published(), 1);
  assert.equal(testRelay.updated()?.publishedAt instanceof Date, true);
});

test('outbox relay dead-letters events from another source instead of publishing them', async () => {
  const event = { ...validEvent(), sourceId: 'api-gateway' };
  const testRelay = relayFor(event);
  const result = await testRelay.relay.flushOnce();
  assert.deepEqual(result, { claimed: 1, published: 0, retried: 0, deadLettered: 1 });
  assert.equal(testRelay.published(), 0);
  assert.equal(testRelay.updated()?.lastErrorCode, 'INVALID_ENVELOPE');
});
