import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  edgeEventBatchRequestSchema,
  edgeCardAssignmentRequestSchema,
  edgeCardAssignmentResultSchema,
  edgeCardBlockResultSchema,
  edgeCardCommandRequestSchema,
  edgeCardReplacementRequestResultSchema,
  edgeCustomerProfilePatchRequestSchema,
  edgeCustomerProfileSchema,
  edgeCustomerSearchPageSchema,
  edgeCustomerSearchQuerySchema,
  edgeHouseholdMemberCreateRequestSchema,
  edgeHouseholdMemberMutationResultSchema,
  edgeHouseholdMutationResultSchema,
  edgeHouseholdPatchRequestSchema,
  edgeHouseholdReadSchema,
  edgeProfileMutationResultSchema,
  edgeIngestResponseSchema,
  edgeSnapshotPageSchema,
  edgeTransactionPayloadSchema,
} from '../dist/index.js';

const fixtureUrl = new URL(
  '../../../contracts/events/device/windows-edge-contract.v1.fixtures.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const fixtureKey = Buffer.from('windows-edge-contract-fixture-only-key');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function signature(bytes) {
  return `sha256=${createHmac('sha256', fixtureKey).update(bytes).digest('hex')}`;
}

test('Windows Edge v1.0.0 transaction and batch fixtures validate strictly', () => {
  assert.equal(edgeTransactionPayloadSchema.safeParse(fixture.event).success, true);
  assert.equal(
    edgeTransactionPayloadSchema.safeParse(fixture.invalidEventWithoutRequiredNullableKey).success,
    false,
  );
  assert.equal(
    edgeEventBatchRequestSchema.safeParse({
      sourceInstanceId: fixture.event.sourceInstanceId,
      events: [fixture.event],
    }).success,
    true,
  );
  assert.equal(edgeIngestResponseSchema.safeParse(fixture.validResponse).success, true);
  assert.equal(
    edgeIngestResponseSchema.safeParse(fixture.invalidUnknownAcceptedResult).success,
    false,
  );
});

test('Edge card assignment, block, and replacement request fixtures validate strictly', () => {
  assert.equal(
    edgeCardAssignmentRequestSchema.safeParse(fixture.cardOperations.assignmentRequest).success,
    true,
  );
  assert.equal(
    edgeCardAssignmentRequestSchema.safeParse(
      fixture.cardOperations.invalidAssignmentWithoutVersion,
    ).success,
    false,
  );
  assert.equal(
    edgeCardAssignmentResultSchema.safeParse(fixture.cardOperations.assignmentResult).success,
    true,
  );
  assert.equal(
    edgeCardCommandRequestSchema.safeParse(fixture.cardOperations.blockRequest).success,
    true,
  );
  assert.equal(
    edgeCardBlockResultSchema.safeParse(fixture.cardOperations.blockResult).success,
    true,
  );
  assert.equal(
    edgeCardCommandRequestSchema.safeParse(fixture.cardOperations.replacementRequest).success,
    true,
  );
  assert.equal(
    edgeCardReplacementRequestResultSchema.safeParse(fixture.cardOperations.replacementResult)
      .success,
    true,
  );
});

test('Edge customer and household DTO fixtures remain minimal, masked, and versioned', () => {
  const data = fixture.customerOperations;
  assert.equal(
    edgeCustomerSearchQuerySchema.safeParse({ branchId: fixture.event.branchId, query: 'آرمان' })
      .success,
    true,
  );
  assert.equal(edgeCustomerSearchPageSchema.safeParse(data.searchPage).success, true);
  assert.equal(
    edgeCustomerSearchPageSchema.safeParse(data.invalidSearchPageWithRawPhone).success,
    false,
  );
  assert.equal(edgeCustomerProfileSchema.safeParse(data.profile).success, true);
  assert.equal(
    edgeCustomerProfileSchema.safeParse({ ...data.profile, maskedPhone: '+989123456789' }).success,
    false,
  );
  assert.equal(edgeCustomerProfilePatchRequestSchema.safeParse(data.profilePatch).success, true);
  assert.equal(
    edgeCustomerProfilePatchRequestSchema.safeParse(data.invalidProfilePatchWithoutChanges).success,
    false,
  );
  assert.equal(edgeProfileMutationResultSchema.safeParse(data.profileMutationResult).success, true);
  assert.equal(edgeHouseholdReadSchema.safeParse(data.household).success, true);
  assert.equal(edgeHouseholdPatchRequestSchema.safeParse(data.householdPatch).success, true);
  assert.equal(edgeHouseholdMemberCreateRequestSchema.safeParse(data.memberCreate).success, true);
  assert.equal(
    edgeHouseholdMutationResultSchema.safeParse(data.householdMutationResult).success,
    true,
  );
  assert.equal(
    edgeHouseholdMemberMutationResultSchema.safeParse(data.memberMutationResult).success,
    true,
  );
});

test('snapshot signing covers signingKeyId and uses ordinal canonical JSON', () => {
  const unsigned = fixture.snapshotUnsigned;
  const pageSignature = signature(Buffer.from(stableStringify(unsigned), 'utf8'));
  const page = { ...unsigned, signature: pageSignature };
  assert.equal(edgeSnapshotPageSchema.safeParse(page).success, true);
  assert.equal(pageSignature, fixture.snapshotSignature);

  const alteredUnsigned = { ...page, signingKeyId: 'different-key' };
  delete alteredUnsigned.signature;
  assert.notEqual(signature(Buffer.from(stableStringify(alteredUnsigned), 'utf8')), pageSignature);
});

test('Edge raw-body HMAC fixture uses lowercase hexadecimal output', () => {
  const rawBody = Buffer.from(
    JSON.stringify({
      sourceInstanceId: fixture.event.sourceInstanceId,
      events: [fixture.event],
    }),
    'utf8',
  );
  const requestSignature = signature(rawBody);
  assert.match(requestSignature, /^sha256=[a-f0-9]{64}$/u);
  assert.equal(requestSignature, fixture.requestSignature);
});
