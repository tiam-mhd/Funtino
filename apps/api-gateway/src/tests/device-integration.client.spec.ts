import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import { DeviceIntegrationClient } from '../infrastructure/device-integration/device-integration.client.js';

const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const deviceId = '44444444-4444-4444-8444-444444444444';
const actorId = '11111111-1111-4111-8111-111111111111';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';
const token = 'development-device-integration-gateway-token-32-chars';

class TestClient extends DeviceIntegrationClient {
  constructor(private readonly responder: (url: URL, init: RequestInit) => Promise<Response>) {
    super();
  }
  protected override fetcher(url: URL, init: RequestInit) {
    return this.responder(url, init);
  }
}

function configure() {
  const old = {
    url: process.env.DEVICE_INTEGRATION_URL,
    token: process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN,
    env: process.env.NODE_ENV,
  };
  process.env.DEVICE_INTEGRATION_URL = 'http://device-integration.internal:4020';
  process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = token;
  delete process.env.NODE_ENV;
  return () => {
    if (old.url === undefined) delete process.env.DEVICE_INTEGRATION_URL;
    else process.env.DEVICE_INTEGRATION_URL = old.url;
    if (old.token === undefined) delete process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    else process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = old.token;
    if (old.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old.env;
  };
}

function device() {
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
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

function commandMeta() {
  return { actorUserId: actorId, correlationId, idempotencyKey };
}

test('list forwards only bounded scope filters with the private Gateway identity and validates owner data', async () => {
  const restore = configure();
  try {
    const client = new TestClient(async (url, init) => {
      assert.equal(url.pathname, `/internal/v1/organizations/${organizationId}/devices`);
      assert.equal(url.searchParams.get('branchId'), branchId);
      assert.equal(url.searchParams.get('status'), 'active');
      assert.equal(url.searchParams.get('pageSize'), '10');
      assert.equal(url.searchParams.get('cursor'), deviceId);
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-service-id'), 'api-gateway');
      assert.equal(headers.get('x-funtino-service-token'), token);
      assert.equal(headers.get('cache-control'), 'no-store');
      return Response.json({ items: [device()], nextCursor: null });
    });
    const page = await client.listDevices({
      organizationId,
      branchId,
      status: 'active',
      cursor: deviceId,
      pageSize: 10,
    });
    assert.equal(page.items[0]?.healthState, 'unknown');
    assert.equal(page.nextCursor, null);
  } finally {
    restore();
  }
});

test('registration and update forward actor, correlation, idempotency, body and optimistic version', async () => {
  const restore = configure();
  try {
    let call = 0;
    const client = new TestClient(async (url, init) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-actor-user-id'), actorId);
      assert.equal(headers.get('x-correlation-id'), correlationId);
      assert.equal(headers.get('idempotency-key'), idempotencyKey);
      if (call++ === 0) {
        assert.equal(init.method, 'POST');
        assert.equal(
          url.pathname,
          `/internal/v1/organizations/${organizationId}/branches/${branchId}/devices`,
        );
        assert.deepEqual(JSON.parse(String(init.body)), {
          adapterKey: 'manual',
          externalDeviceId: 'terminal-01',
          displayName: 'Front terminal',
          deviceType: 'terminal',
          reason: 'Initial inventory registration',
        });
        return Response.json({ deviceId, status: 'active', version: 1 }, { status: 201 });
      }
      assert.equal(init.method, 'PATCH');
      assert.equal(
        url.pathname,
        `/internal/v1/organizations/${organizationId}/branches/${branchId}/devices/${deviceId}`,
      );
      assert.equal(headers.get('if-match'), '"7"');
      assert.deepEqual(JSON.parse(String(init.body)), {
        status: 'suspended',
        reason: 'Scheduled maintenance work',
      });
      return Response.json({ deviceId, status: 'suspended', version: 8 });
    });
    await client.registerDevice(
      organizationId,
      branchId,
      {
        adapterKey: 'manual',
        externalDeviceId: 'terminal-01',
        displayName: 'Front terminal',
        deviceType: 'terminal',
        reason: 'Initial inventory registration',
      },
      commandMeta(),
    );
    const result = await client.updateDevice(
      organizationId,
      branchId,
      deviceId,
      7,
      {
        status: 'suspended',
        reason: 'Scheduled maintenance work',
      },
      commandMeta(),
    );
    assert.equal(result.version, 8);
  } finally {
    restore();
  }
});

test('private service configuration and malformed owner data fail closed', async () => {
  const restore = configure();
  try {
    delete process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    await assert.rejects(
      new TestClient(async () => {
        throw new Error('must not call');
      }).listDevices({ organizationId, pageSize: 10 }),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
    process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = token;
    await assert.rejects(
      new TestClient(async () =>
        Response.json({ items: [{ ...device(), healthState: 'manual-online' }], nextCursor: null }),
      ).listDevices({ organizationId, pageSize: 10 }),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    restore();
  }
});
