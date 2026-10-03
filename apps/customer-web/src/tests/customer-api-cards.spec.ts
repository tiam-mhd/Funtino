import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CustomerApiError,
  getCustomerCards,
  getCustomerBranches,
  getCustomerHouseholds,
} from '../lib/customer-api.js';

const cardId = '11111111-1111-4111-8111-111111111111';
const householdId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';

function stubSuccess(data: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 'success', data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('card API accepts the scoped DTO and strips unknown/raw identifier fields', async (context) => {
  const restoreFetch = stubSuccess([
    {
      id: cardId,
      householdId,
      memberId: null,
      branchId,
      maskedCardId: '•••• •••• 1234',
      externalCardId: 'RAW-CARD-IDENTIFIER',
      status: 'active',
      lastSyncedAt: '2026-10-01T10:00:00.000Z',
      walletId: null,
      isStale: false,
      freshness: 'fresh',
    },
  ]);
  context.after(restoreFetch);

  const [card] = await getCustomerCards();
  assert.equal(card?.householdId, householdId);
  assert.equal(card?.maskedCardId, '•••• •••• 1234');
  assert.equal('externalCardId' in (card ?? {}), false);
});

test('invalid card DTOs fail closed instead of presenting unvalidated status or freshness', async (context) => {
  const restoreFetch = stubSuccess([
    {
      id: cardId,
      householdId,
      memberId: 'not-a-uuid',
      branchId,
      maskedCardId: 'RAW-CARD-IDENTIFIER',
      status: 'connected',
      lastSyncedAt: 'not-a-date',
      walletId: null,
      isStale: false,
    },
  ]);
  context.after(restoreFetch);

  await assert.rejects(getCustomerCards(), (error: unknown) => {
    assert.ok(error instanceof CustomerApiError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.statusCode, 502);
    return true;
  });
});

test('household and branch APIs expose only validated minimum display fields', async (context) => {
  const restoreFetch = stubSuccess([
    {
      id: householdId,
      name: 'خانواده‌ی مجاز',
      ownerUserId: 'must-not-reach-the-view',
      members: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          displayName: ' آراد ',
          birthDate: '2018-03-02',
          relationship: 'child',
        },
      ],
    },
  ]);
  context.after(restoreFetch);

  const [household] = await getCustomerHouseholds();
  assert.deepEqual(household, {
    id: householdId,
    name: 'خانواده‌ی مجاز',
    members: [{ id: memberId, displayName: 'آراد' }],
  });
  assert.equal('ownerUserId' in (household ?? {}), false);

  const restoreBranches = stubSuccess([{ id: branchId, name: ' شعبه‌ی مرکزی ', status: 'open' }]);
  try {
    assert.deepEqual(await getCustomerBranches(), [
      { id: branchId, name: 'شعبه‌ی مرکزی', status: 'open' },
    ]);
  } finally {
    restoreBranches();
  }
});
