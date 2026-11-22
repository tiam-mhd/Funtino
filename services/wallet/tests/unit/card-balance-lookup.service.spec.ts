import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CardBalanceLookupService } from '../../src/application/card-balance-lookup.service.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';

const cardUidHash = '34b8d380d481b933d5238d945a16ee6c0be176960926735bce473b829e4bd517';
const householdId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const organizationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const branchId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function harness(input: {
  assignment?: {
    cardId: string;
    card: { balanceProjection: Record<string, unknown> | null };
  } | null;
  pendingCount?: number;
}) {
  let where: unknown;
  let pendingWhere: unknown;
  let isolationLevel: unknown;
  const prisma = {
    $transaction: async (
      work: (tx: unknown) => Promise<unknown>,
      options: { isolationLevel: unknown },
    ) => {
      isolationLevel = options.isolationLevel;
      return work({
        cardAssignment: {
          findFirst: async (args: { where: unknown }) => {
            where = args.where;
            return input.assignment ?? null;
          },
        },
        edgeEventInbox: {
          count: async (args: { where: unknown }) => {
            pendingWhere = args.where;
            return input.pendingCount ?? 0;
          },
        },
      });
    },
  } as unknown as PrismaService;
  return {
    service: new CardBalanceLookupService(prisma),
    get where() {
      return where as Record<string, unknown> | undefined;
    },
    get pendingWhere() {
      return pendingWhere as Record<string, unknown> | undefined;
    },
    get isolationLevel() {
      return isolationLevel;
    },
  };
}

function projection(overrides: Record<string, unknown> = {}) {
  return {
    balanceRial: 1_250_000n,
    lastConfirmedSnapshotAt: new Date('2026-11-22T08:00:00.000Z'),
    freshness: 'fresh',
    pendingTransactionCount: 0,
    reconciliationDifferenceRial: null,
    ...overrides,
  };
}

function assignment(projectionValue: Record<string, unknown> | null = projection()) {
  return {
    cardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    card: { balanceProjection: projectionValue },
  };
}

test('returns only a safe fresh Wallet balance for a matching customer household', async () => {
  const testHarness = harness({ assignment: assignment() });
  const result = await testHarness.service.lookup({
    cardUidHash,
    audience: { type: 'customer', householdIds: [householdId] },
  });

  assert.deepEqual(result, { status: 'available', balanceRial: 1_250_000 });
  assert.deepEqual(testHarness.where?.householdId, { in: [householdId] });
  assert.deepEqual(testHarness.where?.card, {
    is: {
      cardUidHash,
      status: 'assigned',
      verificationStatus: 'verified',
    },
  });
  assert.equal(testHarness.isolationLevel, 'RepeatableRead');
  assert.deepEqual(testHarness.pendingWhere, {
    cardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    status: 'pending_review',
  });
  assert.deepEqual(Object.keys(result), ['status', 'balanceRial']);
});

test('constrains operations lookup to organization and branch in both assignment and card', async () => {
  const testHarness = harness({ assignment: assignment() });
  await testHarness.service.lookup({
    cardUidHash,
    audience: { type: 'operations', organizationId, branchId },
  });

  assert.equal(testHarness.where?.organizationId, organizationId);
  assert.equal(testHarness.where?.branchId, branchId);
  assert.deepEqual(testHarness.where?.card, {
    is: {
      cardUidHash,
      status: 'assigned',
      verificationStatus: 'verified',
      organizationId,
      branchId,
    },
  });
});

test('uses the same unavailable result for unknown, blocked, unverified, or out-of-scope cards', async () => {
  const testHarness = harness({ assignment: null });
  const result = await testHarness.service.lookup({
    cardUidHash,
    audience: { type: 'operations', organizationId, branchId },
  });

  assert.deepEqual(result, { status: 'unavailable' });
  assert.equal('balanceRial' in result, false);
});

test('hides balances when the projection is stale, unconfirmed, pending, or unreconciled', async () => {
  const scenarios = [
    { snapshot: projection({ freshness: 'stale' }), pendingCount: 0 },
    { snapshot: projection({ lastConfirmedSnapshotAt: null }), pendingCount: 0 },
    { snapshot: projection({ pendingTransactionCount: 1 }), pendingCount: 0 },
    { snapshot: projection(), pendingCount: 1 },
    { snapshot: projection({ reconciliationDifferenceRial: 1n }), pendingCount: 0 },
    {
      snapshot: projection({ balanceRial: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
      pendingCount: 0,
    },
  ];

  for (const scenario of scenarios) {
    const testHarness = harness({
      assignment: assignment(scenario.snapshot),
      pendingCount: scenario.pendingCount,
    });
    const result = await testHarness.service.lookup({
      cardUidHash,
      audience: { type: 'customer', householdIds: [householdId] },
    });
    assert.deepEqual(result, { status: 'pending' });
  }
});
