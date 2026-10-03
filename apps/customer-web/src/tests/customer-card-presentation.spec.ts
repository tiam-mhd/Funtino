import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomerBranchSummary,
  CustomerCard,
  CustomerHouseholdSummary,
} from '../lib/customer-api.js';
import {
  customerCardFreshnessLabel,
  resolveCustomerCardRelations,
} from '../lib/customer-card-presentation.js';

const card: CustomerCard = {
  id: 'card-1',
  householdId: 'household-1',
  memberId: null,
  branchId: 'branch-1',
  maskedCardId: '•••• 1234',
  status: 'active',
  lastSyncedAt: '2026-10-01T10:00:00.000Z',
  walletId: null,
  isStale: false,
  freshness: 'fresh',
};

const households: CustomerHouseholdSummary[] = [
  {
    id: 'household-1',
    name: 'خانواده‌ی مجاز',
    members: [{ id: 'member-1', displayName: 'آراد' }],
  },
];

const branches: CustomerBranchSummary[] = [
  { id: 'branch-1', name: 'شعبه‌ی مرکزی', status: 'open' },
];

test('shared family card resolves only its household and branch', () => {
  assert.deepEqual(
    resolveCustomerCardRelations(card, households, branches, {
      households: true,
      branches: true,
    }),
    {
      householdName: 'خانواده‌ی مجاز',
      branchName: 'شعبه‌ی مرکزی',
      branchStatus: 'فعال',
    },
  );

  const wrongHousehold = [{ ...households[0]!, id: 'another-household' }];
  const relation = resolveCustomerCardRelations(card, wrongHousehold, branches, {
    households: true,
    branches: true,
  });
  assert.equal(relation.householdName, 'خانواده در فهرست معتبر پیدا نشد');
});

test('unavailable or missing owner lookups never invent a member or branch label', () => {
  const relation = resolveCustomerCardRelations(card, [], [], {
    households: false,
    branches: false,
  });
  assert.equal(relation.householdName, 'نام خانواده فعلاً در دسترس نیست');
  assert.equal(relation.branchName, 'اطلاعات شعبه فعلاً در دسترس نیست');
  assert.equal(relation.branchStatus, null);

  const missingBranch = resolveCustomerCardRelations(card, households, [], {
    households: true,
    branches: true,
  });
  assert.equal(missingBranch.branchName, 'شعبه در فهرست معتبر پیدا نشد');
  assert.equal(missingBranch.branchStatus, null);
});

test('freshness comes from the validated device status contract', () => {
  assert.equal(customerCardFreshnessLabel(card), 'آخرین وضعیت به‌روز است');
  assert.equal(
    customerCardFreshnessLabel({ ...card, freshness: 'stale', isStale: true }),
    'آخرین وضعیت قدیمی است',
  );
  assert.equal(
    customerCardFreshnessLabel({
      ...card,
      freshness: 'unknown',
      lastSyncedAt: null,
      isStale: true,
    }),
    'وضعیت دستگاه هنوز گزارش نشده',
  );
  assert.equal(
    customerCardFreshnessLabel({ ...card, lastSyncedAt: 'not-a-date' }),
    'زمان آخرین وضعیت معتبر نیست',
  );
});
