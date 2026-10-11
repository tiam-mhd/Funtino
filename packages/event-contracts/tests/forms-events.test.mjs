import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventTypes } from '../dist/index.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const formId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const responseId = '55555555-5555-4555-8555-555555555555';
const correlationId = '66666666-6666-4666-8666-666666666666';

test('Forms events are scoped, versioned and contain no response content', () => {
  const published = createEventEnvelope({
    eventType: eventTypes.formPublished,
    sourceId: 'forms',
    aggregateId: formId,
    correlationId,
    organizationId,
    branchId,
    payload: { formId, formVersionId: versionId, organizationId, branchId, version: 1 },
  });
  assert.equal(published.eventType, 'forms.form-published.v1');

  const submitted = createEventEnvelope({
    eventType: eventTypes.formResponseSubmitted,
    sourceId: 'forms',
    aggregateId: responseId,
    correlationId,
    organizationId,
    branchId,
    payload: { responseId, formId, formVersionId: versionId, organizationId, branchId },
  });
  assert.equal(submitted.eventType, 'forms.response-submitted.v1');
  assert.equal(JSON.stringify(submitted).includes('answers'), false);
  assert.equal(JSON.stringify(submitted).includes('email'), false);
  assert.throws(() =>
    createEventEnvelope({
      eventType: eventTypes.formResponseSubmitted,
      sourceId: 'forms',
      aggregateId: responseId,
      correlationId,
      organizationId,
      branchId,
      payload: { responseId, formId, formVersionId: versionId, organizationId, branchId, answers: { name: 'x' } },
    }),
  );

  const corrected = createEventEnvelope({
    eventType: eventTypes.formResponseCorrected,
    sourceId: 'forms',
    aggregateId: responseId,
    correlationId,
    organizationId,
    branchId,
    payload: { responseId, formId, organizationId, branchId, correctionVersion: 1, changedFieldCount: 2 },
  });
  assert.equal(corrected.eventType, 'forms.response-corrected.v1');
  assert.equal(JSON.stringify(corrected).includes('answers'), false);
  assert.equal(JSON.stringify(corrected).includes('email'), false);
  assert.throws(() =>
    createEventEnvelope({
      eventType: eventTypes.formResponseCorrected,
      sourceId: 'forms',
      aggregateId: responseId,
      correlationId,
      organizationId,
      branchId,
      payload: { responseId, formId, organizationId, branchId, correctionVersion: 1, changedFieldCount: 2, answers: { email: 'hidden' } },
    }),
  );
});
