import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import type { EventBus } from '@funtino/backend-core';
import { DeviceOutboxRelayService } from '../../src/infrastructure/messaging/outbox/device-outbox-relay.service.js';
import { HmacDeviceSignatureService } from '../../src/infrastructure/security/hmac-device-signature.service.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';

test('device webhook HMAC requires a configured long secret and exact sha256 format', () => {
  const previous = process.env.DEVICE_WEBHOOK_SECRET;
  try {
    const secret = 'test-only-device-webhook-secret-value';
    process.env.DEVICE_WEBHOOK_SECRET = secret;
    const rawBody = Buffer.from('{"event":"health"}', 'utf8');
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    const verifier = new HmacDeviceSignatureService();
    assert.equal(verifier.isConfigured(), true);
    assert.equal(verifier.verify(rawBody, `sha256=${signature}`), true);
    assert.equal(verifier.verify(Buffer.from('{"event":"changed"}'), `sha256=${signature}`), false);
    assert.equal(verifier.verify(rawBody, signature), false);
    assert.equal(verifier.verify(rawBody, `sha256=${'0'.repeat(64)}`), false);
  } finally {
    if (previous === undefined) delete process.env.DEVICE_WEBHOOK_SECRET;
    else process.env.DEVICE_WEBHOOK_SECRET = previous;
  }
});

test('device webhook HMAC is not considered configured when the runtime key is too short', () => {
  const previous = process.env.DEVICE_WEBHOOK_SECRET;
  try {
    process.env.DEVICE_WEBHOOK_SECRET = 'short';
    const verifier = new HmacDeviceSignatureService();
    assert.equal(verifier.isConfigured(), false);
    assert.equal(verifier.verify(Buffer.from('{}'), 'sha256=0'.repeat(64)), false);
  } finally {
    if (previous === undefined) delete process.env.DEVICE_WEBHOOK_SECRET;
    else process.env.DEVICE_WEBHOOK_SECRET = previous;
  }
});

function validDeviceEvent() {
  return createEventEnvelope({
    eventType: eventTypes.deviceRegistered,
    sourceId: 'device-integration',
    aggregateId: deviceId,
    organizationId,
    branchId,
    correlationId,
    payload: {
      deviceId,
      deviceType: 'rfid_reader',
      displayName: 'Reader 1',
      status: 'active',
      version: 1,
    },
  });
}

function relayFor(envelope: unknown, publish: () => Promise<void> = async () => {}) {
  let updated: Record<string, unknown> | undefined;
  let published = 0;
  const parsed = envelope as { eventId: string; eventType: string; aggregateId: string };
  const row = {
    id: parsed.eventId,
    eventType: parsed.eventType,
    aggregateId: parsed.aggregateId,
    envelope,
    attempts: 0,
    leaseToken: '55555555-5555-4555-8555-555555555555',
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
  const bus: EventBus = {
    publish: async () => {
      published += 1;
      await publish();
    },
    close: async () => {},
  };
  const relay = new DeviceOutboxRelayService(
    prisma as unknown as PrismaService,
    bus,
    'amqp://localhost',
  );
  return { relay, published: () => published, updated: () => updated };
}

test('outbox publishes only valid events owned by Device Integration and acknowledges the lease', async () => {
  const testRelay = relayFor(validDeviceEvent());
  const result = await testRelay.relay.flushOnce();
  assert.deepEqual(result, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });
  assert.equal(testRelay.published(), 1);
  assert.equal(testRelay.updated()?.publishedAt instanceof Date, true);
});

test('outbox dead-letters a foreign source rather than publishing it', async () => {
  const testRelay = relayFor({ ...validDeviceEvent(), sourceId: 'api-gateway' });
  const result = await testRelay.relay.flushOnce();
  assert.deepEqual(result, { claimed: 1, published: 0, retried: 0, deadLettered: 1 });
  assert.equal(testRelay.published(), 0);
  assert.equal(testRelay.updated()?.lastErrorCode, 'INVALID_ENVELOPE');
});

test('outbox failures are scheduled for bounded retry without leaking exception details', async () => {
  const testRelay = relayFor(validDeviceEvent(), async () => {
    throw new Error('provider secret must not be logged');
  });
  const result = await testRelay.relay.flushOnce();
  assert.deepEqual(result, { claimed: 1, published: 0, retried: 1, deadLettered: 0 });
  assert.equal(testRelay.updated()?.lastErrorCode, 'PUBLISH_FAILED');
});
