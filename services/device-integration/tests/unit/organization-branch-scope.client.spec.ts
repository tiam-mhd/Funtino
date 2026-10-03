import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { OrganizationBranchScopeClient } from '../../src/infrastructure/organization-branch/organization-branch-scope.client.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const previousUrl = process.env.ORGANIZATION_BRANCH_INTERNAL_URL;
const previousToken = process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN;
const previousFetch = globalThis.fetch;

function restoreEnvironment() {
  if (previousUrl === undefined) delete process.env.ORGANIZATION_BRANCH_INTERNAL_URL;
  else process.env.ORGANIZATION_BRANCH_INTERNAL_URL = previousUrl;
  if (previousToken === undefined) delete process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN;
  else process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN = previousToken;
  globalThis.fetch = previousFetch;
}

test('branch validator uses the Device Integration service identity and owner response', async () => {
  try {
    process.env.ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050/';
    process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-test-token-0123456789';
    let observedRequest: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url, init) => {
      observedRequest = { url: String(url), init };
      return new Response(JSON.stringify({ valid: true, organizationId, branchId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId);
    assert.equal(
      observedRequest.url,
      'http://organization-branch:4050/internal/v1/scopes/validate',
    );
    assert.equal(
      (observedRequest.init?.headers as Record<string, string>)['x-funtino-service-id'],
      'device-integration',
    );
    assert.equal(
      (observedRequest.init?.headers as Record<string, string>)['x-funtino-service-token'],
      process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN,
    );
  } finally {
    restoreEnvironment();
  }
});

test('branch validator rejects inactive or mismatched owner scopes', async () => {
  try {
    process.env.ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050';
    process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-test-token-0123456789';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ valid: false, reason: 'branch_unavailable' }), {
        status: 200,
      })) as typeof fetch;
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ConflictException,
    );
  } finally {
    restoreEnvironment();
  }
});

test('branch validator treats malformed owner responses as unavailable', async () => {
  try {
    process.env.ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050';
    process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-test-token-0123456789';
    for (const payload of ['null', '[]', '"unexpected"', '{"valid":"true"}']) {
      globalThis.fetch = (async () =>
        new Response(payload, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
      await assert.rejects(
        () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
        ServiceUnavailableException,
      );
    }
  } finally {
    restoreEnvironment();
  }
});

test('branch validator fails closed when owner service is unavailable or unconfigured', async () => {
  try {
    delete process.env.ORGANIZATION_BRANCH_INTERNAL_URL;
    process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN = 'runtime-only-test-token-0123456789';
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ServiceUnavailableException,
    );
    process.env.ORGANIZATION_BRANCH_INTERNAL_URL = 'http://organization-branch:4050';
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    await assert.rejects(
      () => new OrganizationBranchScopeClient().assertActiveBranch(organizationId, branchId),
      ServiceUnavailableException,
    );
  } finally {
    restoreEnvironment();
  }
});
