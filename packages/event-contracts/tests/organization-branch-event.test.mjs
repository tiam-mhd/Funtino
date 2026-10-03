import assert from 'node:assert/strict';
import test from 'node:test';
import {
  branchCreatedPayloadSchema,
  branchStatusChangedPayloadSchema,
  createEventEnvelope,
  eventTypes,
  organizationCreatedPayloadSchema,
  organizationStatusChangedPayloadSchema,
} from '../dist/index.js';

const organizationId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';

test('organization lifecycle event payloads are versioned, strict and scoped', () => {
  const payload = {
    id: organizationId,
    name: 'Funtino',
    slug: 'funtino',
    timezone: 'Asia/Tehran',
    status: 'active',
    version: 1,
  };
  const event = createEventEnvelope({
    eventType: eventTypes.organizationCreated,
    sourceId: 'organization-branch',
    aggregateId: organizationId,
    correlationId,
    organizationId,
    payload,
  });
  assert.equal(event.eventType, 'organization.organization-created.v1');
  assert.deepEqual(organizationCreatedPayloadSchema.parse(event.payload), payload);
  assert.equal(
    organizationCreatedPayloadSchema.safeParse({ ...payload, phone: '+1000000000' }).success,
    false,
  );
  assert.equal(
    organizationStatusChangedPayloadSchema.safeParse({
      organizationId,
      previousStatus: 'active',
      status: 'suspended',
      version: 2,
    }).success,
    true,
  );
});

test('branch lifecycle payload validates business hours and parent identity', () => {
  const payload = {
    id: branchId,
    organizationId,
    name: 'Iran Mall',
    slug: 'iranmall',
    address: 'Tehran',
    city: 'Tehran',
    timezone: 'Asia/Tehran',
    status: 'active',
    version: 1,
    openingHours: { friday: { open: '10:00', close: '23:00' }, saturday: null },
  };
  assert.equal(branchCreatedPayloadSchema.safeParse(payload).success, true);
  assert.equal(
    branchCreatedPayloadSchema.safeParse({
      ...payload,
      openingHours: { friday: { open: '25:00', close: '23:00' } },
    }).success,
    false,
  );
  assert.equal(
    branchStatusChangedPayloadSchema.safeParse({
      branchId,
      organizationId,
      previousStatus: 'active',
      status: 'suspended',
      version: 2,
    }).success,
    true,
  );
});
