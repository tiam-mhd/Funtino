import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEventEnvelope,
  eventTypes,
  identityPolicyChangedEventSchema,
  identityPolicyChangedPayloadSchema,
} from '../dist/index.js';

const auditId = '35fc8fa0-70a6-4b10-a24a-6b60e81862ab';
const targetId = 'e29dd2b7-f356-44dc-9c15-49bb90dbb273';
const correlationId = 'dd817fc5-6d7b-4e63-b6e8-a6bd0da06f2d';

test('access-policy-changed accepts the versioned minimal invalidation payload', () => {
  const payload = {
    auditId,
    policyVersion: 2,
    changeType: 'role.updated',
    targetType: 'role',
    targetId,
  };

  const event = createEventEnvelope({
    eventType: eventTypes.identityPolicyChanged,
    sourceId: 'identity-access',
    aggregateId: targetId,
    correlationId,
    payload,
    organizationId: 'cfe4d287-9317-4a7d-b972-0ceca5a80e64',
  });

  assert.equal(event.eventType, 'identity.access-policy-changed.v1');
  assert.deepEqual(event.payload, payload);
  assert.equal(identityPolicyChangedEventSchema.safeParse(event).success, true);
});

test('access-policy-changed rejects unsupported change types and extra payload fields', () => {
  assert.equal(
    identityPolicyChangedPayloadSchema.safeParse({
      auditId,
      policyVersion: 2,
      changeType: 'role.purged',
      targetType: 'role',
      targetId,
    }).success,
    false,
  );
  assert.equal(
    identityPolicyChangedPayloadSchema.safeParse({
      auditId,
      policyVersion: 2,
      changeType: 'role.updated',
      targetType: 'role',
      targetId,
      email: 'not-allowed@example.invalid',
    }).success,
    false,
  );
});

test('the IAM envelope rejects extra top-level data', () => {
  const event = createEventEnvelope({
    eventType: eventTypes.identityPolicyChanged,
    sourceId: 'identity-access',
    aggregateId: targetId,
    correlationId,
    payload: {
      auditId,
      policyVersion: 2,
      changeType: 'role.updated',
      targetType: 'role',
      targetId,
    },
  });

  assert.equal(
    identityPolicyChangedEventSchema.safeParse({ ...event, email: 'private@example.invalid' })
      .success,
    false,
  );
});
