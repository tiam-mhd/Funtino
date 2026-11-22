import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listOperationsDeviceBranches,
  listOperationsDevices,
  registerOperationsDevice,
  updateOperationsDevice,
  type OperationsDevice,
} from '../lib/api/operations-devices';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const cursor = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const eventId = '66666666-6666-4666-8666-666666666666';

async function withFetchStub<T>(
  stub: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function successResponse(data: unknown, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ status: 'success', data, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function device(): OperationsDevice {
  return {
    id: deviceId,
    organizationId,
    branchId,
    adapterKey: 'manual',
    externalDeviceId: 'terminal-01',
    displayName: 'Front terminal',
    deviceType: 'terminal',
    status: 'active',
    healthState: 'unknown',
    latestReportedState: null,
    latestObservedAt: null,
    freshnessSeconds: null,
    version: 4,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

test('Edge sync dashboard uses branch session API and validates owner state', async () => {
  const { getOperationsEdgeSyncStatus } = await import('../lib/api/operations-devices');
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/edge-sync`,
      );
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return successResponse({
        organizationId,
        branchId,
        installations: [],
        pendingCount: 0,
        deadLetterCount: 1,
        deadLetters: [
          {
            outboxEventId: eventId,
            eventId,
            sourceInstanceId: deviceId,
            localTransactionId: 'local-12',
            errorCode: 'PUBLISH_FAILED',
            attempts: 8,
            deadLetteredAt: '2026-11-18T10:00:00.000Z',
            createdAt: '2026-11-18T09:00:00.000Z',
          },
        ],
        deadLettersTruncated: false,
        walletReview: null,
      });
    },
    async () => {
      const status = await getOperationsEdgeSyncStatus(organizationId, branchId);
      assert.equal(status.deadLetterCount, 1);
      assert.equal(status.deadLetters[0]?.eventId, eventId);
    },
  );
});

test('Edge dead-letter replay sends the mandatory review cause with an idempotency key', async () => {
  const { replayOperationsEdgeDeadLetter } = await import('../lib/api/operations-devices');
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/edge-sync/dead-letters/${eventId}/replay`,
      );
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('idempotency-key'), idempotencyKey);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        reason: 'Reviewed the failure and fixed the connection',
      });
      return successResponse({ eventId, outboxEventId: deviceId, status: 'queued_for_replay' });
    },
    async () => {
      const result = await replayOperationsEdgeDeadLetter(
        organizationId,
        branchId,
        eventId,
        'Reviewed the failure and fixed the connection',
        idempotencyKey,
      );
      assert.equal(result.eventId, eventId);
      assert.equal(result.status, 'queued_for_replay');
    },
  );
});

test('pairing permission choices are fetched from the authenticated branch session without caching', async () => {
  const { getOperationsEdgePairingPermissions } = await import('../lib/api/operations-devices');
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/v1/operations/edge/pairing-permissions');
      assert.equal(url.searchParams.get('branchId'), branchId);
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return successResponse({ branchId, permissionKeys: ['card.assign'] });
    },
    async () => {
      const result = await getOperationsEdgePairingPermissions(branchId);
      assert.deepEqual(result, { branchId, permissionKeys: ['card.assign'] });
    },
  );
});

test('pairing approval sends only selected permissions and reuses the caller idempotency key', async () => {
  const { approveOperationsEdgePairing } = await import('../lib/api/operations-devices');
  await withFetchStub(
    (input, init) => {
      assert.equal(new URL(String(input)).pathname, '/api/v1/operations/edge/pairing-approvals');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'include');
      assert.equal(new Headers(init?.headers).get('idempotency-key'), idempotencyKey);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        branchId,
        code: 'ABCD2-EFGH3',
        permissionKeys: ['card.assign'],
      });
      return successResponse({
        status: 'approved',
        branchId,
        permissionKeys: ['card.assign'],
        expiresAt: '2026-11-22T12:05:00.000Z',
      });
    },
    async () => {
      const result = await approveOperationsEdgePairing(
        branchId,
        'ABCD2-EFGH3',
        ['card.assign'],
        idempotencyKey,
      );
      assert.equal(result.status, 'approved');
      assert.deepEqual(result.permissionKeys, ['card.assign']);
    },
  );
});

test('branch-scoped device listing sends selected scope and preserves cursor/capability data', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/v1/operations/devices');
      assert.equal(url.searchParams.get('scopeType'), 'branch');
      assert.equal(url.searchParams.get('organizationId'), organizationId);
      assert.equal(url.searchParams.get('branchId'), branchId);
      assert.equal(url.searchParams.get('status'), 'active');
      assert.equal(url.searchParams.get('cursor'), cursor);
      assert.equal(url.searchParams.get('pageSize'), '100');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return successResponse(
        {
          items: [device()],
          capabilities: { canRegister: true, canManage: true, canReadBranches: true },
        },
        { nextCursor: null },
      );
    },
    async () => {
      const page = await listOperationsDevices(
        { type: 'branch', organizationId, branchId },
        cursor,
        'active',
      );
      assert.deepEqual(page, {
        data: [device()],
        nextCursor: null,
        capabilities: { canRegister: true, canManage: true, canReadBranches: true },
      });
    },
  );
});

test('organization device scope excludes branch id and branch directory uses its own cursor', async () => {
  await withFetchStub(
    (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/operations/devices') {
        assert.equal(url.searchParams.get('scopeType'), 'organization');
        assert.equal(url.searchParams.get('branchId'), null);
        assert.equal(url.searchParams.get('organizationId'), organizationId);
        return successResponse(
          {
            items: [],
            capabilities: { canRegister: false, canManage: false, canReadBranches: true },
          },
          { nextCursor: cursor },
        );
      }
      assert.equal(url.pathname, `/api/v1/operations/organizations/${organizationId}/branches`);
      assert.equal(url.searchParams.get('cursor'), cursor);
      return successResponse(
        { items: [{ id: branchId, organizationId, name: 'Central', city: 'Tehran' }] },
        { nextCursor: null },
      );
    },
    async () => {
      const devices = await listOperationsDevices({ type: 'organization', organizationId });
      assert.equal(devices.nextCursor, cursor);
      const branches = await listOperationsDeviceBranches(organizationId, cursor);
      assert.equal(branches.data[0]?.id, branchId);
    },
  );
});

test('registration and lifecycle mutation send idempotency and optimistic concurrency headers', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('idempotency-key'), idempotencyKey);
      if (init?.method === 'POST') {
        assert.equal(
          url.pathname,
          `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/devices`,
        );
        assert.equal(headers.get('if-match'), null);
        return successResponse({ deviceId, status: 'active', version: 1 });
      }
      assert.equal(init?.method, 'PATCH');
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/devices/${deviceId}`,
      );
      assert.equal(headers.get('if-match'), '"4"');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        status: 'suspended',
        reason: 'Scheduled maintenance work',
      });
      return successResponse({ deviceId, status: 'suspended', version: 5 });
    },
    async () => {
      await registerOperationsDevice(
        organizationId,
        branchId,
        {
          adapterKey: 'manual',
          externalDeviceId: 'terminal-01',
          displayName: 'Front terminal',
          deviceType: 'terminal',
          reason: 'Initial inventory registration',
        },
        idempotencyKey,
      );
      const result = await updateOperationsDevice(
        device(),
        { status: 'suspended', reason: 'Scheduled maintenance work' },
        idempotencyKey,
      );
      assert.equal(result.version, 5);
    },
  );
});
