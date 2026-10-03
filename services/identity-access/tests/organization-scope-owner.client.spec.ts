import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { OrganizationScopeOwnerClient } from '../src/infrastructure/organization-branch/organization-scope-owner.client.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const previousUrl = process.env.ORGANIZATION_BRANCH_URL;
const previousToken = process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
const previousNodeEnv = process.env.NODE_ENV;
const previousFetch = globalThis.fetch;

function restoreEnvironment(): void {
  if (previousUrl === undefined) delete process.env.ORGANIZATION_BRANCH_URL;
  else process.env.ORGANIZATION_BRANCH_URL = previousUrl;
  if (previousToken === undefined) delete process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
  else process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN = previousToken;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  globalThis.fetch = previousFetch;
}

function configure(): string {
  const token = 'runtime-only-identity-access-owner-token-0123456789';
  process.env.ORGANIZATION_BRANCH_URL = 'http://organization-branch.internal:4050/';
  process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN = token;
  return token;
}

test('IAM owner client sends a resource-only scope validation with its dedicated service identity', async () => {
  try {
    const token = configure();
    let observed: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url, init) => {
      observed = { url: String(url), init };
      return new Response(JSON.stringify({ valid: true, organizationId, organizationVersion: 3 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new OrganizationScopeOwnerClient();
    assert.equal(client.isConfigured(), true);
    assert.deepEqual(await client.validateScope({ type: 'organization', organizationId }), {
      valid: true,
      organizationId,
      organizationVersion: 3,
    });
    assert.equal(
      observed.url,
      'http://organization-branch.internal:4050/internal/v1/scopes/validate',
    );
    assert.equal(observed.init?.method, 'POST');
    assert.equal(observed.init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(observed.init?.body)), {
      type: 'organization',
      organizationId,
    });
    const headers = observed.init?.headers as Record<string, string>;
    assert.equal(headers['x-funtino-service-id'], 'identity-access');
    assert.equal(headers['x-funtino-service-token'], token);
    assert.equal(headers.authorization, undefined);
  } finally {
    restoreEnvironment();
  }
});

test('production owner validation requires HTTPS and never follows redirects', async () => {
  try {
    configure();
    process.env.NODE_ENV = 'production';
    const client = new OrganizationScopeOwnerClient();
    assert.equal(client.isConfigured(), false);
    await assert.rejects(
      () => client.validateScope({ type: 'organization', organizationId }),
      ServiceUnavailableException,
    );

    process.env.ORGANIZATION_BRANCH_URL = 'https://organization-branch.internal:4050';
    let redirectMode: RequestRedirect | undefined;
    globalThis.fetch = (async (_url, init) => {
      redirectMode = init?.redirect;
      return new Response(JSON.stringify({ valid: true, organizationId, organizationVersion: 3 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    assert.equal(client.isConfigured(), true);
    await client.validateScope({ type: 'organization', organizationId });
    assert.equal(redirectMode, 'error');
  } finally {
    restoreEnvironment();
  }
});

test('IAM owner client validates active branch identity and owner versions', async () => {
  try {
    configure();
    globalThis.fetch = (async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: 'branch',
        organizationId,
        branchId,
      });
      return new Response(
        JSON.stringify({
          valid: true,
          organizationId,
          organizationVersion: 3,
          branchId,
          branchVersion: 7,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    assert.deepEqual(
      await new OrganizationScopeOwnerClient().validateScope({
        type: 'branch',
        organizationId,
        branchId,
      }),
      { valid: true, organizationId, organizationVersion: 3, branchId, branchVersion: 7 },
    );
  } finally {
    restoreEnvironment();
  }
});

test('IAM owner client returns inactive scopes as invalid without exposing owner details', async () => {
  try {
    configure();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ valid: false, reason: 'branch_unavailable' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    assert.deepEqual(
      await new OrganizationScopeOwnerClient().validateScope({
        type: 'branch',
        organizationId,
        branchId,
      }),
      { valid: false, reason: 'branch_unavailable' },
    );
  } finally {
    restoreEnvironment();
  }
});

test('IAM owner client rejects invalid or mismatched owner responses', async () => {
  try {
    configure();
    for (const payload of [
      'null',
      '[]',
      '{"valid":"true"}',
      JSON.stringify({
        valid: true,
        organizationId: '33333333-3333-4333-8333-333333333333',
        organizationVersion: 1,
      }),
      JSON.stringify({ valid: true, organizationId, organizationVersion: 1, branchId }),
      JSON.stringify({
        valid: true,
        organizationId,
        organizationVersion: 1,
        branchId: '33333333-3333-4333-8333-333333333333',
        branchVersion: 1,
      }),
    ]) {
      globalThis.fetch = (async () =>
        new Response(payload, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
      await assert.rejects(
        () =>
          new OrganizationScopeOwnerClient().validateScope({
            type: 'branch',
            organizationId,
            branchId,
          }),
        ServiceUnavailableException,
      );
    }
  } finally {
    restoreEnvironment();
  }
});

test('IAM owner client fails closed for missing configuration, network errors, and non-success status', async () => {
  try {
    delete process.env.ORGANIZATION_BRANCH_URL;
    process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN =
      'runtime-only-identity-access-owner-token-0123456789';
    const client = new OrganizationScopeOwnerClient();
    assert.equal(client.isConfigured(), false);
    await assert.rejects(
      () => client.validateScope({ type: 'organization', organizationId }),
      ServiceUnavailableException,
    );

    configure();
    globalThis.fetch = (async () => {
      throw new Error('network unavailable');
    }) as typeof fetch;
    await assert.rejects(
      () => client.validateScope({ type: 'organization', organizationId }),
      ServiceUnavailableException,
    );

    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    await assert.rejects(
      () => client.validateScope({ type: 'organization', organizationId }),
      ServiceUnavailableException,
    );
  } finally {
    restoreEnvironment();
  }
});
