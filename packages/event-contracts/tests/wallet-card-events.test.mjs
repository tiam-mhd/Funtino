import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventPayloadSchemas, eventTypes } from '../dist/index.js';

const cardId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';

test('Wallet registration event is versioned, scoped, and excludes the physical identifier', () => {
  const event = createEventEnvelope({
    eventType: eventTypes.walletCardRegistered,
    sourceId: 'wallet',
    aggregateId: cardId,
    organizationId,
    branchId,
    correlationId,
    payload: {
      cardId,
      status: 'in_stock',
      verificationStatus: 'unknown',
      version: 1,
    },
  });

  assert.equal(event.eventType, 'wallet.card-registered.v1');
  assert.equal(event.eventVersion, 1);
  assert.equal(event.payload.cardId, cardId);
  assert.equal('externalCardId' in event.payload, false);
});

test('Wallet event contracts reject private card identifiers and unknown lifecycle values', () => {
  const registered = eventPayloadSchemas[eventTypes.walletCardRegistered];
  assert.equal(
    registered.safeParse({
      cardId,
      status: 'in_stock',
      verificationStatus: 'unknown',
      version: 1,
      externalCardId: 'private-card-identifier',
    }).success,
    false,
  );

  const changed = eventPayloadSchemas[eventTypes.walletCardStatusChanged];
  assert.equal(
    changed.safeParse({
      cardId,
      previousStatus: 'blocked',
      status: 'in_stock',
      version: 2,
    }).success,
    true,
  );
  assert.equal(
    changed.safeParse({ cardId, previousStatus: 'retired', status: 'in_stock', version: 2 })
      .success,
    false,
  );
});
