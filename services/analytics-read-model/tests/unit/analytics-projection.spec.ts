import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';
import { AnalyticsProjectionService } from '../../src/application/analytics-projection.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';
const generationId = '55555555-5555-4555-8555-555555555555';

test('event archive de-duplication makes projection and daily counters idempotent', async () => {
  const archivedEventIds = new Set<string>();
  let deviceUpserts = 0;
  let dailyUpserts = 0;
  const transaction = {
    $executeRaw: async () => 1,
    analyticsEvent: {
      createMany: async ({ data }: { data: Array<{ eventId: string }> }) => {
        const [event] = data;
        if (!event || archivedEventIds.has(event.eventId)) return { count: 0 };
        archivedEventIds.add(event.eventId);
        return { count: 1 };
      },
    },
    projectionControl: {
      findUniqueOrThrow: async () => ({
        activeGenerationId: generationId,
        coverageStartedAt: null,
        lastEventAt: null,
      }),
      update: async () => ({}),
    },
    deviceProjection: {
      findUnique: async () => null,
      upsert: async () => {
        deviceUpserts += 1;
        return {};
      },
    },
    dailyOperationalMetric: {
      upsert: async () => {
        dailyUpserts += 1;
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as PrismaService;
  const projection = new AnalyticsProjectionService(prisma);
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
      reportedState: 'online',
      observedAt: new Date().toISOString(),
      isLatest: true,
    },
  });

  assert.equal(await projection.ingest(event), 'processed');
  assert.equal(await projection.ingest(event), 'duplicate');
  assert.equal(archivedEventIds.size, 1);
  assert.equal(deviceUpserts, 1);
  assert.equal(dailyUpserts, 1);
});
