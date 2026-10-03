import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEventEnvelope,
  deviceHealthObservedPayloadSchema,
  deviceRegisteredPayloadSchema,
  deviceUpdatedPayloadSchema,
  eventTypes,
} from '../dist/index.js';

const deviceId = '33333333-3333-4333-8333-333333333333';
const organizationId = '44444444-4444-4444-8444-444444444444';
const branchId = '55555555-5555-4555-8555-555555555555';
const correlationId = '66666666-6666-4666-8666-666666666666';

test('device registration and update payload contracts are strict and versioned', () => {
  const registered = {
    deviceId,
    deviceType: 'rfid_reader',
    displayName: 'Front reader',
    status: 'active',
    version: 1,
  };
  const updated = { ...registered, status: 'suspended', version: 2 };

  assert.deepEqual(deviceRegisteredPayloadSchema.parse(registered), registered);
  assert.equal(
    deviceRegisteredPayloadSchema.safeParse({ ...registered, status: 'retired' }).success,
    false,
  );
  assert.deepEqual(deviceUpdatedPayloadSchema.parse(updated), updated);
  assert.equal(
    deviceUpdatedPayloadSchema.safeParse({ ...updated, externalDeviceId: 'raw-id' }).success,
    false,
  );

  const envelope = createEventEnvelope({
    eventType: eventTypes.deviceRegistered,
    sourceId: 'device-integration',
    aggregateId: deviceId,
    correlationId,
    organizationId,
    branchId,
    payload: registered,
  });
  assert.equal(envelope.eventType, 'device.device-registered.v1');
  assert.equal(envelope.organizationId, organizationId);
  assert.equal(envelope.branchId, branchId);
});

test('health observations are strict, normalized, and preserve out-of-order status', () => {
  const payload = {
    deviceId,
    observationId: '77777777-7777-4777-8777-777777777777',
    reportedState: 'offline',
    observedAt: '2026-10-01T08:00:00.000Z',
    isLatest: false,
  };
  assert.deepEqual(deviceHealthObservedPayloadSchema.parse(payload), payload);
  assert.equal(
    deviceHealthObservedPayloadSchema.safeParse({ ...payload, secret: 'forbidden' }).success,
    false,
  );

  const envelope = createEventEnvelope({
    eventType: eventTypes.deviceHealthObserved,
    sourceId: 'device-integration',
    aggregateId: deviceId,
    correlationId,
    organizationId,
    branchId,
    payload,
  });
  assert.equal(envelope.payload.isLatest, false);
});
