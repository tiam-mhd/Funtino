import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { CardLedgerService } from '../../src/application/card-ledger.service.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';

test('branch review summary aggregates only pending/rejected ledger inbox rows by safe error code', async () => {
  let query: unknown;
  const prisma = {
    $queryRaw: async (value: unknown) => {
      query = value;
      return [
        { status: 'pending_review', errorCode: 'CARD_NOT_REGISTERED', count: 2n, latestAt: new Date('2026-11-18T10:00:00.000Z') },
        { status: 'rejected', errorCode: 'INVALID_EVENT', count: 1n, latestAt: new Date('2026-11-18T09:00:00.000Z') },
        { status: 'pending_review', errorCode: null, count: 1n, latestAt: null },
      ];
    },
  };
  const service = new CardLedgerService(prisma as unknown as PrismaService);
  const result = await service.getBranchEdgeReviewSummary(organizationId, branchId);
  assert.deepEqual(result, {
    organizationId,
    branchId,
    reviewCount: 4,
    rejectedCount: 1,
    latestReviewAt: '2026-11-18T10:00:00.000Z',
    errorsByCode: [
      { errorCode: 'CARD_NOT_REGISTERED', count: 2 },
      { errorCode: 'INVALID_EVENT', count: 1 },
    ],
  });
  assert.ok(query && typeof query === 'object' && 'sql' in query);
  assert.match(String((query as { sql: string }).sql), /card\.organization_id/);
  assert.match(String((query as { sql: string }).sql), /card\.branch_id/);
});

test('physical card read creates a fresh balance and an idempotent append-only reconciliation', async () => {
  const harness = reconciliationHarness();
  const input = validSnapshot();

  const first = await harness.service.reconcilePhysicalBalanceSnapshot(input);
  const duplicate = await harness.service.reconcilePhysicalBalanceSnapshot(input);

  assert.equal(first.balanceRial, 125_000);
  assert.equal(first.freshness, 'fresh');
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(harness.reconciliationCreateCount(), 1);
  assert.equal(harness.projection()?.balanceRial, 125_000n);
  assert.equal(harness.projection()?.pendingTransactionCount, 0);
  assert.equal(harness.projection()?.lastSnapshotSourceInstanceId, input.sourceInstanceId);
  assert.equal(harness.projection()?.lastSnapshotLocalSequence, 20n);
});

test('physical balance reconciliation rejects a conflicting snapshot id and an older sequence', async () => {
  const idempotencyHarness = reconciliationHarness();
  const input = validSnapshot();
  await idempotencyHarness.service.reconcilePhysicalBalanceSnapshot(input);
  await assert.rejects(
    idempotencyHarness.service.reconcilePhysicalBalanceSnapshot({ ...input, balanceRial: 125_001 }),
    (error: unknown) => error instanceof ConflictException,
  );

  const staleHarness = reconciliationHarness({
    latestSequence: 21n,
  });
  await assert.rejects(
    staleHarness.service.reconcilePhysicalBalanceSnapshot(input),
    (error: unknown) => error instanceof ConflictException,
  );

  const wrongOwnerHarness = reconciliationHarness({
    ownerHouseholdId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  await assert.rejects(
    wrongOwnerHarness.service.reconcilePhysicalBalanceSnapshot(input),
    (error: unknown) => error instanceof ConflictException,
  );

  const olderReadHarness = reconciliationHarness({
    projection: {
      balanceRial: 100_000n,
      lastConfirmedSnapshotAt: new Date(Date.now() - 500),
    },
  });
  await assert.rejects(
    olderReadHarness.service.reconcilePhysicalBalanceSnapshot({
      ...input,
      snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      observedAt: new Date(Date.now() - 2_000).toISOString(),
    }),
    (error: unknown) => error instanceof ConflictException,
  );
});

test('installation-wide sequence gaps do not become guessed missing card transactions', async () => {
  const current = {
    cardId: '33333333-3333-4333-8333-333333333333',
    balanceRial: 1_000n,
    lastConfirmedSnapshotAt: new Date('2026-11-17T10:00:00.000Z'),
    lastAppliedEventId: '44444444-4444-4444-8444-444444444444',
    lastSourceInstanceId: '55555555-5555-4555-8555-555555555555',
    lastAppliedLocalSequence: 10n,
    lastSnapshotSourceInstanceId: null,
    lastSnapshotLocalSequence: null,
    freshness: 'fresh',
    pendingTransactionCount: 0,
    reconciliationDifferenceRial: null,
  } satisfies Record<string, unknown>;
  const harness = reconciliationHarness({ projection: current });

  await harness.applyProjection({
    eventId: '66666666-6666-4666-8666-666666666666',
    sourceInstanceId: current.lastSourceInstanceId,
    localSequence: 20,
    cardId: current.cardId,
    amountRial: 50,
    balanceAfterRial: 1_050,
  });

  assert.equal(harness.projection()?.balanceRial, 1_050n);
  assert.equal(harness.projection()?.pendingTransactionCount, 0);
  assert.equal(harness.projection()?.freshness, 'fresh');
});

test('events covered by a later physical read cannot overwrite its balance projection', async () => {
  const harness = reconciliationHarness();
  await harness.service.reconcilePhysicalBalanceSnapshot(validSnapshot());
  const originalProjection = harness.projection();

  await harness.applyProjection({
    eventId: '77777777-7777-4777-8777-777777777777',
    sourceInstanceId: '55555555-5555-4555-8555-555555555555',
    localSequence: 19,
    cardId: '33333333-3333-4333-8333-333333333333',
    amountRial: -500,
    balanceAfterRial: 124_500,
  });

  assert.equal(harness.projection()?.balanceRial, originalProjection?.balanceRial);
  assert.equal(harness.projection()?.freshness, originalProjection?.freshness);
});

function validSnapshot() {
  return {
    snapshotId: '88888888-8888-4888-8888-888888888888',
    sourceInstanceId: '55555555-5555-4555-8555-555555555555',
    organizationId,
    branchId,
    cardId: '33333333-3333-4333-8333-333333333333',
    householdId: '99999999-9999-4999-8999-999999999999',
    memberId: null,
    snapshotVersion: 'branch-v7',
    localSequence: 20,
    balanceRial: 125_000,
    currencyCode: 'IRR' as const,
    observedAt: new Date(Date.now() - 1_000).toISOString(),
  };
}

function reconciliationHarness(options: {
  projection?: Record<string, unknown> | null;
  latestSequence?: bigint | null;
  ownerHouseholdId?: string;
} = {}) {
  let projection = options.projection ?? null;
  const reconciliations = new Map<string, Record<string, unknown>>();
  let createCount = 0;
  const transactionClient = {
    $queryRaw: async () => [],
    cardBalanceReconciliation: {
      findUnique: async ({ where }: { where: { snapshotId: string } }) => reconciliations.get(where.snapshotId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, createdAt: new Date() };
        reconciliations.set(String(data.snapshotId), row);
        createCount += 1;
        return row;
      },
    },
    cardInventory: {
      findFirst: async () => ({ id: '33333333-3333-4333-8333-333333333333' }),
    },
    cardAssignmentHistory: {
      findFirst: async () => ({
        action: 'assigned',
        householdId: options.ownerHouseholdId ?? '99999999-9999-4999-8999-999999999999',
        memberId: null,
      }),
    },
    cardAssignment: {
      findFirst: async ({ where }: { where: { householdId: string } }) =>
        where.householdId === (options.ownerHouseholdId ?? '99999999-9999-4999-8999-999999999999')
          ? { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
          : null,
    },
    cardBalanceProjection: {
      findUnique: async () => projection,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        projection = projection === null ? create : { ...projection, ...update };
        return projection;
      },
    },
    cardLedgerEntry: {
      findFirst: async () => options.latestSequence === undefined || options.latestSequence === null
        ? null
        : { localSequence: options.latestSequence },
    },
  };
  const prisma = {
    cardBalanceReconciliation: {
      findUnique: async ({ where }: { where: { snapshotId: string } }) => reconciliations.get(where.snapshotId) ?? null,
    },
    $transaction: async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient),
  } as unknown as PrismaService;
  const service = new CardLedgerService(prisma);
  const privateProjectionUpdate = (service as unknown as {
    updateProjection: (client: typeof transactionClient, event: Record<string, unknown>) => Promise<void>;
  }).updateProjection;
  return {
    service,
    projection: () => projection,
    reconciliationCreateCount: () => createCount,
    applyProjection: (event: Record<string, unknown>) => privateProjectionUpdate.call(service, transactionClient, event),
  };
}
