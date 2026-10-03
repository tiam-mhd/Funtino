import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeviceRegistryService } from '../../src/application/device-registry.service.js';
import type { BranchScopeValidator } from '../../src/application/ports/branch-scope-validator.port.js';
import type { DeviceRegistryRepository } from '../../src/application/ports/device-registry.repository.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const correlationId = '66666666-6666-4666-8666-666666666666';

function setup(overrides: Record<string, unknown> = {}) {
  const calls: { branch?: unknown[]; register?: unknown[]; report?: unknown[] } = {};
  const repository = {
    findIdempotentMutation: async () => null,
    findTransactionImportReplay: async () => null,
    registerDevice: async (...args: unknown[]) => {
      calls.register = args;
      return { deviceId, status: 'active' as const, version: 1 };
    },
    updateDevice: async () => ({ deviceId, status: 'suspended' as const, version: 2 }),
    listDevices: async () => ({ items: [], nextCursor: null }),
    getDevice: async () => ({
      id: deviceId,
      organizationId,
      branchId,
      adapterKey: 'rfid.v1',
      externalDeviceId: 'reader-1',
      displayName: 'Reader',
      deviceType: 'rfid_reader' as const,
      status: 'active' as const,
      latestReportedState: null,
      latestObservedAt: null,
      version: 1,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    }),
    recordHealthObservation: async (...args: unknown[]) => {
      calls.report = args;
      return {
        accepted: true as const,
        duplicate: false,
        deviceId,
        observationId: '77777777-7777-4777-8777-777777777777',
        observedAt: '2026-10-01T00:00:00.000Z',
        isLatest: true,
      };
    },
    importTransactionEvent: async () => ({
      accepted: true as const,
      duplicate: false,
      externalEventId: 'legacy-event-1',
      transactionId: deviceId,
    }),
    isReady: async () => {},
    ...overrides,
  } as unknown as DeviceRegistryRepository;
  const branchScope = {
    assertActiveBranch: async (...args: unknown[]) => {
      calls.branch = args;
    },
  } as BranchScopeValidator;
  const service = new DeviceRegistryService(repository, branchScope, () => ({
    staleAfterSeconds: 300,
    offlineAfterSeconds: 900,
  }));
  return { service, calls };
}

const meta = {
  callerService: 'api-gateway' as const,
  actorUserId,
  correlationId,
  idempotencyKey,
};

test('registration validates current branch ownership and normalizes identity before persistence', async () => {
  const { service, calls } = setup();
  const result = await service.registerDevice(
    organizationId,
    branchId,
    {
      adapterKey: ' RFID.V1 ',
      externalDeviceId: ' reader-1 ',
      displayName: ' Reader 1 ',
      deviceType: 'rfid_reader',
      reason: 'Initial pilot registration',
    },
    meta,
  );
  assert.deepEqual(calls.branch, [organizationId, branchId]);
  assert.equal((calls.register?.[0] as { adapterKey: string }).adapterKey, 'rfid.v1');
  assert.equal((calls.register?.[0] as { externalDeviceId: string }).externalDeviceId, 'reader-1');
  assert.equal(result.deviceId, deviceId);
});

test('a committed idempotent registration replays before a later branch suspension is consulted', async () => {
  const expected = { deviceId, status: 'active' as const, version: 1 };
  const repository = {
    findIdempotentMutation: async () => expected,
    registerDevice: async () => assert.fail('idempotent replay must not create another device'),
  };
  const branchScope = {
    assertActiveBranch: async () =>
      assert.fail('a committed retry must not revalidate branch state'),
  } as BranchScopeValidator;
  const service = new DeviceRegistryService(
    repository as unknown as DeviceRegistryRepository,
    branchScope,
    () => ({ staleAfterSeconds: 300, offlineAfterSeconds: 900 }),
  );
  const result = await service.registerDevice(
    organizationId,
    branchId,
    {
      adapterKey: 'manual',
      externalDeviceId: 'reader-1',
      displayName: 'Reader 1',
      deviceType: 'rfid_reader',
      reason: 'Pilot registration',
    },
    meta,
  );
  assert.deepEqual(result, expected);
});

test('branch owner rejection fails closed before the registry is written', async () => {
  const repository = {
    findIdempotentMutation: async () => null,
    registerDevice: async () => assert.fail('registry write must not happen'),
  };
  const branchScope = {
    assertActiveBranch: async () => {
      throw new ConflictException('branch unavailable');
    },
  } as BranchScopeValidator;
  const service = new DeviceRegistryService(
    repository as unknown as DeviceRegistryRepository,
    branchScope,
    () => ({ staleAfterSeconds: 300, offlineAfterSeconds: 900 }),
  );
  await assert.rejects(
    () =>
      service.registerDevice(
        organizationId,
        branchId,
        {
          adapterKey: 'manual',
          externalDeviceId: 'device-1',
          displayName: 'Device 1',
          deviceType: 'other',
          reason: 'Pilot registration',
        },
        meta,
      ),
    ConflictException,
  );
});

test('future health observations are rejected before persistence', async () => {
  const repository = {
    recordHealthObservation: async () => assert.fail('future observation must not persist'),
  };
  const { service } = setup(repository);
  await assert.rejects(
    () =>
      service.reportHealth(
        {
          organizationId,
          adapterKey: 'manual',
          externalDeviceId: 'device-1',
          externalObservationId: 'health-1',
          reportedState: 'online',
          observedAt: new Date(Date.now() + 61_000).toISOString(),
        },
        correlationId,
      ),
    BadRequestException,
  );
});

test('health observations pass normalized identity and correlation to the repository', async () => {
  const { service, calls } = setup();
  await service.reportHealth(
    {
      organizationId,
      adapterKey: ' MANUAL ',
      externalDeviceId: ' device-1 ',
      externalObservationId: 'health-1',
      reportedState: 'online',
      observedAt: new Date().toISOString(),
    },
    correlationId,
  );
  const command = calls.report?.[0] as {
    adapterKey: string;
    externalDeviceId: string;
    correlationId: string;
  };
  assert.equal(command.adapterKey, 'manual');
  assert.equal(command.externalDeviceId, 'device-1');
  assert.equal(command.correlationId, correlationId);
});

test('an old transaction retry replays before the freshness window is enforced', async () => {
  const expected = {
    accepted: true as const,
    duplicate: true,
    externalEventId: 'legacy-event-1',
    transactionId: deviceId,
  };
  const { service } = setup({ findTransactionImportReplay: async () => expected });
  const result = await service.importTransactionEvent(
    {
      externalEventId: 'legacy-event-1',
      organizationId,
      branchId,
      externalCardId: 'card-1',
      transactionKind: 'spend',
      amountMinor: 100,
      currency: 'IRR',
      occurredAt: '2020-01-01T00:00:00.000Z',
    },
    correlationId,
  );
  assert.deepEqual(result, expected);
});
