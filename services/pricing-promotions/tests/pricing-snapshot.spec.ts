import assert from 'node:assert/strict';
import test from 'node:test';
import { PricingSnapshotService } from '../src/pricing-snapshot.service.js';

test('offline pricing stays explicitly disabled without approved Windows vectors', () => {
  const result = new PricingSnapshotService().getOfflineSnapshot('11111111-1111-4111-8111-111111111111');
  assert.deepEqual(result, {
    branchId: '11111111-1111-4111-8111-111111111111',
    status: 'disabled',
    version: null,
    reasonCode: 'PENDING_WINDOWS_GOLDEN_VECTORS',
    validFrom: null,
    validUntil: null,
    rules: [],
  });
});
