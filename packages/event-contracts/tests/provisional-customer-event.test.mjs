import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventPayloadSchemas, eventTypes } from '../dist/index.js';

const payload = {
  provisionalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  branchId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'pending_review',
};

test('provisional customer event is versioned, minimal and rejects PII additions', () => {
  const parsed = eventPayloadSchemas[eventTypes.provisionalCustomerCreated].safeParse(payload);
  assert.equal(parsed.success, true);
  assert.equal(
    eventPayloadSchemas[eventTypes.provisionalCustomerCreated].safeParse({
      ...payload,
      phoneE164: '+989121234567',
    }).success,
    false,
  );

  const envelope = createEventEnvelope({
    eventType: eventTypes.provisionalCustomerCreated,
    sourceId: 'customer-household',
    aggregateId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    correlationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: payload.branchId,
    payload,
  });
  assert.equal(envelope.eventType, 'customer.provisional-created.v1');
  assert.equal(envelope.payload.status, 'pending_review');
});
