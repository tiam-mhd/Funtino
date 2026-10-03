import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';
import { OperationsReportService } from '../../src/application/operations-report.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const generationId = '22222222-2222-4222-8222-222222222222';

test('organization totals include every branch even when the displayed comparison is capped at 500', async () => {
  const branches = Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name: `Branch ${index + 1}`,
    status: 'active' as const,
  }));
  let healthQuery = 0;
  const tx = {
    projectionControl: { findUnique: async () => ({ activeGenerationId: generationId }) },
    branchProjection: {
      findMany: async ({ take }: { take: number }) => branches.slice(0, take),
      groupBy: async () => [{ status: 'active', _count: { _all: 501 } }],
    },
    $queryRaw: async () => {
      healthQuery += 1;
      if (healthQuery === 1) {
        return [
          { lifecycleStatus: 'active', healthState: 'online', count: 2 },
          { lifecycleStatus: 'retired', healthState: 'offline', count: 1 },
        ];
      }
      return [
        { branchId: branches[0]!.id, lifecycleStatus: 'active', healthState: 'online', count: 2 },
      ];
    },
    organizationProjection: { findUnique: async () => ({ status: 'active' }) },
    dailyOperationalMetric: { groupBy: async () => [] },
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  const service = new OperationsReportService(prisma);
  const today = new Date().toISOString().slice(0, 10);

  const report = await service.getReport({
    scopeType: 'organization',
    organizationId,
    from: today,
    to: today,
  });

  assert.equal(report.snapshot.branchBreakdown.length, 500);
  assert.equal(report.snapshot.branchBreakdownTruncated, true);
  assert.equal(report.snapshot.devices.total, 3);
  assert.equal(report.snapshot.devices.active, 2);
  assert.equal(report.snapshot.devices.retired, 1);
  assert.equal(report.snapshot.devices.health.online, 2);
  assert.equal(report.snapshot.devices.health.offline, 1);
});
