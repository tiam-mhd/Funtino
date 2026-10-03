import assert from 'node:assert/strict';
import test from 'node:test';
import { eventTypes } from '@funtino/event-contracts';
import { PrismaDeviceRegistryRepository } from '../../src/infrastructure/persistence/prisma/prisma-device-registry.repository.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

const meta = { callerService: 'api-gateway' as const, actorUserId, correlationId, idempotencyKey };
const device = {
  id: deviceId,
  organizationId,
  branchId,
  adapterKey: 'manual',
  externalDeviceId: 'reader-1',
  displayName: 'Reader 1',
  deviceType: 'rfid_reader' as const,
  status: 'active' as const,
  latestReportedState: null,
  latestObservedAt: null,
  version: 1,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

test('registration, append-only audit and event outbox share one database transaction', async () => {
  let inTransaction = false;
  const writes: string[] = [];
  let savedResponse: unknown;
  const tx = {
    idempotencyCommand: {
      create: async () => {
        assert.equal(inTransaction, true);
        writes.push('idempotency.create');
      },
      update: async (args: { data: { response: unknown } }) => {
        assert.equal(inTransaction, true);
        savedResponse = args.data.response;
        writes.push('idempotency.complete');
      },
    },
    device: {
      create: async () => {
        assert.equal(inTransaction, true);
        writes.push('device.create');
        return device;
      },
    },
    deviceAuditLog: {
      create: async () => {
        assert.equal(inTransaction, true);
        writes.push('audit.create');
      },
    },
    outboxEvent: {
      create: async (args: { data: { eventType: string } }) => {
        assert.equal(inTransaction, true);
        assert.equal(args.data.eventType, eventTypes.deviceRegistered);
        writes.push('outbox.create');
      },
    },
  };
  const prisma = {
    idempotencyCommand: { findUnique: async () => null },
    $transaction: async <T>(work: (transaction: object) => Promise<T>) => {
      inTransaction = true;
      try {
        return await work(tx);
      } finally {
        inTransaction = false;
      }
    },
  };
  const repository = new PrismaDeviceRegistryRepository(prisma as unknown as PrismaService);
  const result = await repository.registerDevice(
    {
      organizationId,
      branchId,
      adapterKey: 'manual',
      externalDeviceId: 'reader-1',
      displayName: 'Reader 1',
      deviceType: 'rfid_reader',
      reason: 'Pilot setup',
    },
    meta,
  );
  assert.deepEqual(writes, [
    'idempotency.create',
    'device.create',
    'audit.create',
    'outbox.create',
    'idempotency.complete',
  ]);
  assert.deepEqual(result, { deviceId, status: 'active', version: 1 });
  assert.deepEqual(savedResponse, { result });
});

test('same idempotency key replays the exact committed response without another write', async () => {
  const expected = { deviceId, status: 'active', version: 1 };
  const request = {
    operation: 'device.register',
    command: {
      organizationId,
      branchId,
      adapterKey: 'manual',
      externalDeviceId: 'reader-1',
      displayName: 'Reader 1',
      deviceType: 'rfid_reader',
      reason: 'Pilot setup',
    },
    actorUserId,
  };
  const { createHash } = await import('node:crypto');
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  let transactionCalled = false;
  const prisma = {
    idempotencyCommand: {
      findUnique: async () => ({
        requestHash,
        response: { result: expected },
      }),
    },
    $transaction: async () => {
      transactionCalled = true;
      throw new Error('should not run');
    },
  };
  const repository = new PrismaDeviceRegistryRepository(prisma as unknown as PrismaService);
  const result = await repository.registerDevice(request.command as never, meta);
  assert.deepEqual(result, expected);
  assert.equal(transactionCalled, false);
});

test('older health observations are stored but cannot replace newer current health', async () => {
  const writes: Array<{ observation?: unknown; event?: unknown }> = [];
  const tx = {
    device: {
      findUnique: async () => device,
      findFirst: async () => ({ id: deviceId }),
      updateMany: async () => ({ count: 0 }),
    },
    deviceHealthObservation: {
      create: async (args: { data: unknown }) => writes.push({ observation: args.data }),
    },
    outboxEvent: {
      create: async (args: { data: unknown }) => writes.push({ event: args.data }),
    },
  };
  const prisma = {
    device: { findUnique: async () => device },
    deviceHealthObservation: { findUnique: async () => null },
    $transaction: async <T>(work: (transaction: object) => Promise<T>) => work(tx),
  };
  const repository = new PrismaDeviceRegistryRepository(prisma as unknown as PrismaService);
  const result = await repository.recordHealthObservation({
    organizationId,
    adapterKey: 'manual',
    externalDeviceId: 'reader-1',
    externalObservationId: 'observation-old',
    reportedState: 'online',
    observedAt: new Date('2026-10-01T00:00:00.000Z'),
    correlationId,
  });
  assert.equal(result.isLatest, false);
  assert.equal((writes[0].observation as { appliedAsLatest: boolean }).appliedAsLatest, false);
  assert.equal(
    (writes[1].event as { eventType: string }).eventType,
    eventTypes.deviceHealthObserved,
  );
});
