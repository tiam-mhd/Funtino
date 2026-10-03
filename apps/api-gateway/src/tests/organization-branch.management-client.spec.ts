import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const serviceToken = 'development-organization-branch-management-token-32-chars';
const organizationId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
const actorUserId = '11111111-1111-4111-8111-111111111111';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

class TestClient extends OrganizationBranchClient {
  constructor(private readonly responder: (url: URL, init: RequestInit) => Promise<Response>) {
    super();
  }

  protected override fetcher(url: URL, init: RequestInit): Promise<Response> {
    return this.responder(url, init);
  }
}

function configure(): () => void {
  const previous = {
    url: process.env.ORGANIZATION_BRANCH_URL,
    token: process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN,
    environment: process.env.NODE_ENV,
  };
  process.env.ORGANIZATION_BRANCH_URL = 'http://organization-branch.internal:4050';
  process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN = serviceToken;
  delete process.env.NODE_ENV;
  return () => {
    if (previous.url === undefined) delete process.env.ORGANIZATION_BRANCH_URL;
    else process.env.ORGANIZATION_BRANCH_URL = previous.url;
    if (previous.token === undefined) delete process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN;
    else process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN = previous.token;
    if (previous.environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.environment;
  };
}

function ownerOrganization() {
  return {
    id: organizationId,
    name: 'Funtino Central',
    slug: 'funtino-central',
    timezone: 'Asia/Tehran',
    status: 'active',
    version: 3,
    legacyCreatedAtLocal: null,
    legacyUpdatedAtLocal: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
  };
}

function ownerBranch() {
  return {
    id: branchId,
    organizationId,
    name: 'Central Branch',
    slug: 'central-branch',
    address: 'Main street',
    city: 'Tehran',
    timezone: 'Asia/Tehran',
    status: 'suspended',
    openingHours: { saturday: { open: '10:00', close: '22:00' } },
    version: 7,
    legacyCreatedAtLocal: null,
    legacyUpdatedAtLocal: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
  };
}

test('management client retrieves real organization pages with the private Gateway identity', async () => {
  const restore = configure();
  try {
    const client = new TestClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/organizations');
      assert.equal(url.searchParams.get('cursor'), branchId);
      assert.equal(url.searchParams.get('pageSize'), '12');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-service-id'), 'api-gateway');
      assert.equal(headers.get('x-funtino-service-token'), serviceToken);
      assert.equal(headers.get('cache-control'), 'no-store');
      return new Response(JSON.stringify({ items: [ownerOrganization()], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await client.listOrganizations({ cursor: branchId, pageSize: 12 });
    assert.equal(result.items[0]?.status, 'active');
    assert.equal(result.items[0]?.id, organizationId);
  } finally {
    restore();
  }
});

test('management writes forward actor, correlation, idempotency and optimistic version only to the owner', async () => {
  const restore = configure();
  try {
    const input = { status: 'suspended' as const, reason: 'Scheduled maintenance' };
    const client = new TestClient(async (url, init) => {
      assert.equal(url.pathname, `/internal/v1/organizations/${organizationId}/branches/${branchId}/status`);
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), input);
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-service-id'), 'api-gateway');
      assert.equal(headers.get('x-funtino-actor-user-id'), actorUserId);
      assert.equal(headers.get('x-correlation-id'), correlationId);
      assert.equal(headers.get('idempotency-key'), idempotencyKey);
      assert.equal(headers.get('if-match'), '"7"');
      return new Response(JSON.stringify(ownerBranch()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await client.changeBranchStatus(
      organizationId,
      branchId,
      7,
      input,
      { actorUserId, correlationId, idempotencyKey },
    );
    assert.equal(result.status, 'suspended');
    assert.equal(result.version, 7);
  } finally {
    restore();
  }
});

test('management client converts stale owner writes to a conflict and fails closed on missing credentials', async () => {
  const restore = configure();
  try {
    const conflictClient = new TestClient(async () => new Response(null, { status: 409 }));
    await assert.rejects(
      conflictClient.updateOrganization(
        organizationId,
        2,
        { name: 'Renamed Central', reason: 'Correcting display name' },
        { actorUserId, correlationId, idempotencyKey },
      ),
      (error: unknown) => error instanceof DomainError && error.code === 'CONFLICT',
    );

    delete process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN;
    const unavailableClient = new TestClient(async () => {
      throw new Error('Fetch must not be attempted without credentials.');
    });
    await assert.rejects(
      unavailableClient.createOrganization(
        { name: 'New Group', slug: 'new-group', timezone: 'Asia/Tehran', reason: 'Create a new group' },
        { actorUserId, correlationId, idempotencyKey },
      ),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    restore();
  }
});
