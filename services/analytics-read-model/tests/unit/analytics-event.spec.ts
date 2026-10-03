import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import {
  parseAnalyticsEvent,
  parseArchivedAnalyticsEvent,
} from '../../src/domain/reporting/analytics-event.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';

test('branch snapshots are scope-checked and sanitized before entering the replay journal', () => {
  const event = createEventEnvelope({
    eventType: eventTypes.branchCreated,
    sourceId: 'organization-branch',
    aggregateId: branchId,
    organizationId,
    branchId,
    correlationId,
    payload: {
      id: branchId,
      organizationId,
      name: 'مرکزی',
      slug: 'markazi',
      address: 'sensitive street address must not be retained',
      city: 'تهران',
      timezone: 'Asia/Tehran',
      status: 'active',
      openingHours: {},
      version: 1,
    },
  });

  const sanitized = parseAnalyticsEvent(event);
  assert.ok(sanitized);
  assert.deepEqual(sanitized.payload, {
    id: branchId,
    organizationId,
    name: 'مرکزی',
    status: 'active',
    version: 1,
  });
  assert.equal(JSON.stringify(sanitized).includes('sensitive street address'), false);
  assert.deepEqual(parseArchivedAnalyticsEvent(sanitized), sanitized);
});

test('producer scope and aggregate identity must agree with the validated branch payload', () => {
  const event = createEventEnvelope({
    eventType: eventTypes.branchStatusChanged,
    sourceId: 'organization-branch',
    aggregateId: branchId,
    organizationId,
    branchId,
    correlationId,
    payload: {
      branchId,
      organizationId: '55555555-5555-4555-8555-555555555555',
      previousStatus: 'active',
      status: 'suspended',
      version: 2,
    },
  });

  assert.throws(() => parseAnalyticsEvent(event), /ANALYTICS_EVENT_SCOPE_MISMATCH/);
});

test('unowned event types are ignored rather than treated as report facts', () => {
  const event = createEventEnvelope({
    eventType: eventTypes.deviceTransactionImported,
    sourceId: 'device-integration',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    organizationId,
    branchId,
    correlationId,
    payload: {
      transactionId: '55555555-5555-4555-8555-555555555555',
      externalEventId: 'external-1',
      externalCardId: 'physical-card-id',
      transactionKind: 'spend',
      amountMinor: 1500,
      currency: 'IRR',
      occurredAt: new Date().toISOString(),
    },
  });
  assert.equal(parseAnalyticsEvent(event), null);
});

test('health events require a matching device aggregate and replay only sanitized fields', () => {
  const event = createEventEnvelope({
    eventType: eventTypes.deviceHealthObserved,
    sourceId: 'device-integration',
    aggregateId: deviceId,
    organizationId,
    branchId,
    correlationId,
    payload: {
      deviceId,
      observationId: '66666666-6666-4666-8666-666666666666',
      reportedState: 'degraded',
      observedAt: new Date().toISOString(),
      isLatest: true,
    },
  });
  const sanitized = parseAnalyticsEvent(event);
  assert.ok(sanitized);
  assert.deepEqual(parseArchivedAnalyticsEvent(sanitized), sanitized);
  assert.equal(Object.hasOwn(sanitized.payload, 'observationId'), false);
});
