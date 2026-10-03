import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { OrganizationBranchScopeClient } from '../../src/infrastructure/organization-branch/organization-branch-scope.client.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const previousUrl = process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL;
const previousToken = process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
const previousEnvironment = process.env.NODE_ENV;
const previousFetch = globalThis.fetch;

function restore() {
  if (previousUrl === undefined) delete process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL;
  else process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL = previousUrl;
  if (previousToken === undefined) delete process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
  else process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = previousToken;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
  globalThis.fetch = previousFetch;
}

test('branch scope client validates against the Owner API using Wallet identity', async () => {
  try {
    process.env.NODE_ENV = 'test';
    process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050/';
    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-wallet-owner-token-0123456789';
    let request: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ valid: true, organizationId, branchId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId);
    assert.equal(request.url, 'http://organization-branch:4050/internal/v1/scopes/validate');
    assert.equal(request.init?.redirect, 'error');
    const headers = request.init?.headers as Record<string, string>;
    assert.equal(headers['x-funtino-service-id'], 'wallet');
    assert.equal(headers['x-funtino-service-token'], process.env.WALLET_ORGANIZATION_BRANCH_TOKEN);
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      type: 'branch',
      organizationId,
      branchId,
    });
  } finally {
    restore();
  }
});

test('branch scope client requires HTTPS in production and rejects credential-bearing URLs', async () => {
  try {
    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-wallet-owner-token-0123456789';
    process.env.NODE_ENV = 'production';
    process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050';
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ServiceUnavailableException,
    );

    process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL =
      'https://user:password@organization-branch';
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ServiceUnavailableException,
    );
  } finally {
    restore();
  }
});

test('branch scope client rejects owner mismatch and fails closed on dependency errors', async () => {
  try {
    process.env.NODE_ENV = 'test';
    process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050';
    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-wallet-owner-token-0123456789';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          valid: true,
          organizationId,
          branchId: '33333333-3333-4333-8333-333333333333',
        }),
        {
          status: 200,
        },
      )) as typeof fetch;
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ConflictException,
    );

    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ServiceUnavailableException,
    );
  } finally {
    restore();
  }
});
