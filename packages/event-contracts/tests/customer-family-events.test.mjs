import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEventEnvelope,
  eventTypes,
  familyInvitationChangedPayloadSchema,
  familyRelationshipChangedPayloadSchema,
  householdMemberUpdatedPayloadSchema,
} from '../dist/index.js';

const householdId = 'cfe4d287-9317-4a7d-b972-0ceca5a80e64';
const invitationId = '35fc8fa0-70a6-4b10-a24a-6b60e81862ab';
const memberId = 'e29dd2b7-f356-44dc-9c15-49bb90dbb273';
const correlationId = 'dd817fc5-6d7b-4e63-b6e8-a6bd0da06f2d';

test('family invitation events contain only identifiers and the state transition', () => {
  const payload = { householdId, invitationId, memberId, status: 'claim_pending' };
  const event = createEventEnvelope({
    eventType: eventTypes.familyInvitationChanged,
    sourceId: 'customer-household',
    aggregateId: householdId,
    correlationId,
    payload,
  });
  assert.deepEqual(event.payload, payload);
  assert.equal(familyInvitationChangedPayloadSchema.safeParse(payload).success, true);
  assert.equal(
    familyInvitationChangedPayloadSchema.safeParse({ ...payload, shareToken: 'secret' }).success,
    false,
  );
});

test('family relationship events reject free-text and personal data', () => {
  const payload = { householdId, relationshipId: invitationId };
  assert.equal(familyRelationshipChangedPayloadSchema.safeParse(payload).success, true);
  assert.equal(
    familyRelationshipChangedPayloadSchema.safeParse({ ...payload, displayName: 'Name' }).success,
    false,
  );
});

test('family member updates carry only opaque identity, status, and version', () => {
  const payload = { householdId, memberId, status: 'archived', version: 3 };
  assert.equal(householdMemberUpdatedPayloadSchema.safeParse(payload).success, true);
  assert.equal(
    householdMemberUpdatedPayloadSchema.safeParse({ ...payload, displayName: 'Name' }).success,
    false,
  );
});
