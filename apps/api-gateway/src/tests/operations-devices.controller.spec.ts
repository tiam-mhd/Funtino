import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import { OperationsDevicesController } from '../interfaces/http/operations-devices.controller.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import type { DeviceIntegrationClient } from '../infrastructure/device-integration/device-integration.client.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const deviceId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

function session(): Session {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    userId,
    tokenHash: 'hash',
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    mfaVerifiedAt: Date.now(),
    mfaFactorVersion: 1,
    mfaMethod: 'totp',
    isSystemAdmin: false,
    mfaLoginDeadlineAt: null,
    lastActivityAt: Date.now(),
  };
}
function request(withSession = true): AuthenticatedRequest {
  return {
    ...(withSession ? { session: session() } : {}),
    requestId: 'request-1',
    correlationId,
  } as AuthenticatedRequest;
}
function ownerBranch(status: 'active' | 'suspended' = 'active') {
  return { id: branchId, organizationId, name: 'Central', city: 'Tehran', status };
}
function controller(
  access: Partial<IdentityAccessClient> = {},
  owner: Partial<OrganizationBranchClient> = {},
  devices: Partial<DeviceIntegrationClient> = {},
) {
  return new OperationsDevicesController(
    access as IdentityAccessClient,
    owner as OrganizationBranchClient,
    devices as DeviceIntegrationClient,
  );
}

test('device listing requires current IAM scope authorization and fails before owner/device reads when denied', async () => {
  let deviceCalled = false;
  const instance = controller(
    {
      evaluateAuthorization: async (_user, _session, input) => ({
        allowed: input.permission === 'branch.read',
        policyVersion: 1,
        catalogVersion: 1,
      }),
    },
    {
      getOrganization: async () => ({ status: 'active' }) as never,
      getOrganizationBranch: async () => ownerBranch() as never,
    },
    {
      listDevices: async () => {
        deviceCalled = true;
        return { items: [], nextCursor: null };
      },
    },
  );
  await assert.rejects(
    instance.listDevices(
      { id: userId },
      { scopeType: 'branch', organizationId, branchId, pageSize: 10 },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(deviceCalled, false);
});

test('device listing validates live owner scope and returns only server-evaluated capabilities', async () => {
  const checks: string[] = [];
  let ownerReads = 0;
  const instance = controller(
    {
      evaluateAuthorization: async (_user, _session, input) => {
        checks.push(input.permission);
        return {
          allowed: input.permission !== 'device.maintenance.manage',
          policyVersion: 2,
          catalogVersion: 1,
        };
      },
    },
    {
      getOrganization: async () => {
        ownerReads++;
        return { status: 'active' } as never;
      },
      getOrganizationBranch: async () => {
        ownerReads++;
        return ownerBranch() as never;
      },
    },
    {
      listDevices: async (input) => {
        assert.equal(input.branchId, branchId);
        return { items: [], nextCursor: deviceId };
      },
    },
  );
  const result = await instance.listDevices(
    { id: userId },
    { scopeType: 'branch', organizationId, branchId, pageSize: 10 },
    request(),
  );
  assert.equal(ownerReads, 2);
  assert.deepEqual(result.data.capabilities, {
    canRegister: true,
    canManage: false,
    canReadBranches: true,
  });
  assert.equal(result.nextCursor, deviceId);
  assert.deepEqual(checks, ['device.health.read', 'device.register', 'device.maintenance.manage']);
});

test('inactive branch blocks listing and registration even when IAM allows the actor', async () => {
  let registered = false;
  const instance = controller(
    { evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }) },
    {
      getOrganization: async () => ({ status: 'active' }) as never,
      getOrganizationBranch: async () => ownerBranch('suspended') as never,
    },
    {
      registerDevice: async () => {
        registered = true;
        return { deviceId, status: 'active', version: 1 };
      },
    },
  );
  await assert.rejects(
    instance.registerDevice(
      { id: userId },
      organizationId,
      branchId,
      idempotencyKey,
      {
        adapterKey: 'manual',
        externalDeviceId: 'terminal-01',
        displayName: 'Front terminal',
        deviceType: 'terminal',
        reason: 'Initial inventory registration',
      },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'CONFLICT',
  );
  assert.equal(registered, false);
});

test('registration authorizes the exact branch and forwards actor, correlation, and idempotency metadata', async () => {
  let authorization: unknown;
  let metadata: unknown;
  const instance = controller(
    {
      evaluateAuthorization: async (_user, _session, input) => {
        authorization = input;
        return { allowed: true, policyVersion: 1, catalogVersion: 1 };
      },
    },
    {
      getOrganization: async () => ({ status: 'active' }) as never,
      getOrganizationBranch: async () => ownerBranch() as never,
    },
    {
      registerDevice: async (_organizationId, _branchId, _body, meta) => {
        metadata = meta;
        return { deviceId, status: 'active', version: 1 };
      },
    },
  );
  const result = await instance.registerDevice(
    { id: userId },
    organizationId,
    branchId,
    idempotencyKey,
    {
      adapterKey: 'manual',
      externalDeviceId: 'terminal-01',
      displayName: 'Front terminal',
      deviceType: 'terminal',
      reason: 'Initial inventory registration',
    },
    request(),
  );
  assert.deepEqual(authorization, {
    permission: 'device.register',
    scope: { type: 'branch', organizationId, branchId },
    resource: { type: 'branch', id: branchId },
  });
  assert.deepEqual(metadata, { actorUserId: userId, correlationId, idempotencyKey });
  assert.equal(result.data.deviceId, deviceId);
});

test('branch directory requires branch.read and returns only active minimal branch DTOs', async () => {
  let ownerPageQuery: unknown;
  const instance = controller(
    {
      evaluateAuthorization: async (_user, _session, input) => ({
        allowed: input.permission === 'branch.read',
        policyVersion: 1,
        catalogVersion: 1,
      }),
    },
    {
      getOrganization: async () => ({ status: 'active' }) as never,
      listOrganizationBranches: async (_organizationId, query) => {
        ownerPageQuery = query;
        return {
          items: [ownerBranch(), { ...ownerBranch('suspended'), id: deviceId }],
          nextCursor: null,
        } as never;
      },
    },
  );
  const result = await instance.listBranches(
    { id: userId },
    organizationId,
    { pageSize: 20 },
    request(),
  );
  assert.deepEqual(ownerPageQuery, { pageSize: 20 });
  assert.deepEqual(result.data.items, [
    { id: branchId, organizationId, name: 'Central', city: 'Tehran' },
  ]);
});

test('update uses exact resource scope and refuses missing idempotency or unquoted versions', async () => {
  let authorization: unknown;
  let ownerCall: unknown;
  const instance = controller(
    {
      evaluateAuthorization: async (_user, _session, input) => {
        authorization = input;
        return { allowed: true, policyVersion: 1, catalogVersion: 1 };
      },
    },
    {
      getOrganization: async () => ({ status: 'active' }) as never,
      getOrganizationBranch: async () => ownerBranch() as never,
    },
    {
      updateDevice: async (...args) => {
        ownerCall = args;
        return { deviceId, status: 'suspended', version: 2 };
      },
    },
  );
  const result = await instance.updateDevice(
    { id: userId },
    organizationId,
    branchId,
    deviceId,
    '"1"',
    idempotencyKey,
    { status: 'suspended', reason: 'Scheduled maintenance work' },
    request(),
  );
  assert.deepEqual(authorization, {
    permission: 'device.maintenance.manage',
    scope: { type: 'branch', organizationId, branchId },
    resource: { type: 'device', id: deviceId },
  });
  assert.deepEqual(ownerCall, [
    organizationId,
    branchId,
    deviceId,
    1,
    { status: 'suspended', reason: 'Scheduled maintenance work' },
    { actorUserId: userId, correlationId, idempotencyKey },
  ]);
  assert.equal(result.data.version, 2);
  await assert.rejects(
    instance.updateDevice(
      { id: userId },
      organizationId,
      branchId,
      deviceId,
      '2',
      idempotencyKey,
      { status: 'suspended', reason: 'Scheduled maintenance work' },
      request(),
    ),
    (error: unknown) => error instanceof Error,
  );
  await assert.rejects(
    instance.updateDevice(
      { id: userId },
      organizationId,
      branchId,
      deviceId,
      '"1"',
      undefined,
      { status: 'suspended', reason: 'Scheduled maintenance work' },
      request(),
    ),
    (error: unknown) => error instanceof Error,
  );
});
