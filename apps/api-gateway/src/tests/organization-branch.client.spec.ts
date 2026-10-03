import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const gatewayToken = 'development-organization-branch-gateway-token-32-chars';
const branchId = '44444444-4444-4444-8444-444444444444';
const organizationId = '33333333-3333-4333-8333-333333333333';

class TestOrganizationBranchClient extends OrganizationBranchClient {
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
  process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN = gatewayToken;
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

function ownerBranch(status = 'active') {
  return {
    id: branchId,
    organizationId,
    name: 'Iran Mall',
    slug: 'iranmall',
    address: 'Tehran',
    city: 'Tehran',
    timezone: 'Asia/Tehran',
    status,
    openingHours: { saturday: { open: '10:00', close: '23:00' } },
    version: 1,
    legacyCreatedAtLocal: null,
    legacyUpdatedAtLocal: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
  };
}

test('Gateway reads customer branch discovery from the owner service with its private credential', async () => {
  const restore = configure();
  try {
    const client = new TestOrganizationBranchClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/public/branches');
      assert.equal(url.searchParams.get('pageSize'), '100');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-service-id'), 'api-gateway');
      assert.equal(headers.get('x-funtino-service-token'), gatewayToken);
      return new Response(JSON.stringify({ items: [ownerBranch()], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    assert.deepEqual(await client.listActiveBranches(), [
      {
        id: branchId,
        organizationId,
        name: 'Iran Mall',
        slug: 'iranmall',
        address: 'Tehran',
        city: 'Tehran',
        timezone: 'Asia/Tehran',
        isActive: true,
        openingHours: { saturday: { open: '10:00', close: '23:00' } },
      },
    ]);
  } finally {
    restore();
  }
});

test('Gateway follows owner branch pages and rejects a repeated cursor', async () => {
  const restore = configure();
  try {
    const secondBranchId = '77777777-7777-4777-8777-777777777777';
    let calls = 0;
    const client = new TestOrganizationBranchClient(async (url) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(url.searchParams.get('cursor'), null);
        const firstPage = Array.from({ length: 100 }, (_, index) => ({
          ...ownerBranch(),
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        }));
        const cursor = firstPage.at(-1)!.id;
        return new Response(JSON.stringify({ items: firstPage, nextCursor: cursor }), {
          status: 200,
        });
      }
      assert.equal(url.searchParams.get('cursor'), '00000000-0000-4000-8000-000000000100');
      return new Response(
        JSON.stringify({ items: [{ ...ownerBranch(), id: secondBranchId }], nextCursor: null }),
        {
          status: 200,
        },
      );
    });

    const branches = await client.listActiveBranches();
    assert.equal(branches.length, 101);
    assert.equal(calls, 2);

    const looping = new TestOrganizationBranchClient(async () => {
      const items = Array.from({ length: 100 }, (_, index) => ({
        ...ownerBranch(),
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      }));
      return new Response(JSON.stringify({ items, nextCursor: items.at(-1)!.id }), { status: 200 });
    });
    await assert.rejects(
      looping.listActiveBranches(),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    restore();
  }
});

test('Gateway branch owner client fails closed if its token is absent', async () => {
  const previous = process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN;
  delete process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN;
  try {
    const client = new TestOrganizationBranchClient(async () => {
      throw new Error('fetch must not execute');
    });
    await assert.rejects(
      client.getActiveBranch(branchId),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    if (previous !== undefined) process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN = previous;
  }
});

test('Gateway refuses a branch response that is not active and maps a missing active branch', async () => {
  const restore = configure();
  try {
    const inactive = new TestOrganizationBranchClient(
      async () => new Response(JSON.stringify(ownerBranch('suspended')), { status: 200 }),
    );
    await assert.rejects(
      inactive.getActiveBranch(branchId),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
    const missing = new TestOrganizationBranchClient(async () => new Response('', { status: 404 }));
    await assert.rejects(
      missing.getActiveBranch(branchId),
      (error: unknown) => error instanceof DomainError && error.code === 'NOT_FOUND',
    );
  } finally {
    restore();
  }
});
