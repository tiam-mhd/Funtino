import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryFuntinoStore } from '../infrastructure/store/funtino-store.js';

const actorUserId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';

test('in-memory exact-phone lookup quota is fixed-window, capped, and isolated by branch', () => {
  const store = new InMemoryFuntinoStore();
  const windowStartedAt = 1_800_000_000_000;
  const quota = { actorUserId, branchId, windowStartedAt, maxRequests: 30 };

  assert.equal(store.consumeOperationsCustomerLookupQuota(quota), 1);
  for (let count = 2; count <= 30; count += 1) {
    assert.equal(store.consumeOperationsCustomerLookupQuota(quota), count);
  }
  assert.equal(store.consumeOperationsCustomerLookupQuota(quota), 31);
  assert.equal(store.consumeOperationsCustomerLookupQuota(quota), 31);
  assert.equal(
    store.consumeOperationsCustomerLookupQuota({
      ...quota,
      branchId: '33333333-3333-4333-8333-333333333333',
    }),
    1,
  );
  assert.equal(
    store.consumeOperationsCustomerLookupQuota({
      ...quota,
      windowStartedAt: windowStartedAt + 900_000,
    }),
    1,
  );
});
