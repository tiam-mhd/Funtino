import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import { SystemOrganizationController } from '../interfaces/http/system-organization.controller.js';
import type {
  IdentityAccessClient,
  OperationsAccessContext,
} from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const firstOrganizationId = '22222222-2222-4222-8222-222222222222';
const secondOrganizationId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

function organization(id: string) {
  return {
    id,
    name: `Organization ${id.slice(0, 4)}`,
    slug: `organization-${id.slice(0, 4)}`,
    timezone: 'Asia/Tehran',
    status: 'active' as const,
    version: 4,
    legacyCreatedAtLocal: '2020-01-01T00:00:00.000',
    legacyUpdatedAtLocal: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
  };
}

function session(): Session {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    userId,
    tokenHash: 'session-hash',
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

function request(): AuthenticatedRequest {
  return {
    session: session(),
    requestId: 'request-1',
    correlationId,
  } as AuthenticatedRequest;
}

function controller(
  access: Partial<IdentityAccessClient>,
  owner: Partial<OrganizationBranchClient>,
) {
  return new SystemOrganizationController(
    access as IdentityAccessClient,
    owner as OrganizationBranchClient,
  );
}

test('global organization listing uses owner data and omits migration-only fields from its public DTO', async () => {
  let ownerQuery: unknown;
  const instance = controller(
    {
      evaluateAuthorization: async (_actor, _session, request) => ({
        allowed: request.scope.type === 'global',
        policyVersion: 2,
        catalogVersion: 1,
      }),
    },
    {
      listOrganizations: async (query) => {
        ownerQuery = query;
        return { items: [organization(firstOrganizationId)], nextCursor: null };
      },
    },
  );

  const result = await instance.listOrganizations({ id: userId }, { pageSize: 25 }, request());
  assert.deepEqual(ownerQuery, { pageSize: 25 });
  assert.equal(result.data.items[0]?.status, 'active');
  assert.equal('legacyCreatedAtLocal' in (result.data.items[0] ?? {}), false);
});

test('organization-scoped listing filters candidate IDs through live IAM decisions', async () => {
  const requested: string[] = [];
  const instance = controller(
    {
      evaluateAuthorization: async (_actor, _session, authorization) => {
        if (authorization.scope.type === 'global')
          return { allowed: false, policyVersion: 3, catalogVersion: 1 };
        const id = authorization.scope.organizationId;
        requested.push(id);
        return { allowed: id === secondOrganizationId, policyVersion: 3, catalogVersion: 1 };
      },
      currentAccessContext: async () =>
        ({
          memberships: [
            {
              membershipId: 'm1',
              status: 'active',
              scope: { type: 'organization', organizationId: firstOrganizationId },
              role: {},
              version: 1,
            },
            {
              membershipId: 'm2',
              status: 'active',
              scope: { type: 'organization', organizationId: secondOrganizationId },
              role: {},
              version: 1,
            },
            {
              membershipId: 'm3',
              status: 'suspended',
              scope: {
                type: 'organization',
                organizationId: '88888888-8888-4888-8888-888888888888',
              },
              role: {},
              version: 1,
            },
            {
              membershipId: 'm4',
              status: 'active',
              scope: {
                type: 'branch',
                organizationId: '99999999-9999-4999-8999-999999999999',
                branchId,
              },
              role: {},
              version: 1,
            },
          ],
          policyVersion: 3,
          catalogVersion: 1,
        }) as unknown as OperationsAccessContext,
    },
    {
      getOrganization: async (id) => organization(id),
    },
  );

  const result = await instance.listOrganizations({ id: userId }, { pageSize: 25 }, request());
  assert.deepEqual(requested, [firstOrganizationId, secondOrganizationId]);
  assert.deepEqual(
    result.data.items.map((item) => item.id),
    [secondOrganizationId],
  );
  assert.equal(result.data.nextCursor, null);
});

test('organization creation fails closed before calling the owner when IAM denies the request', async () => {
  let ownerCalled = false;
  const instance = controller(
    {
      evaluateAuthorization: async () => ({ allowed: false, policyVersion: 1, catalogVersion: 1 }),
    },
    {
      createOrganization: async () => {
        ownerCalled = true;
        return organization(firstOrganizationId);
      },
    },
  );

  await assert.rejects(
    instance.createOrganization(
      { id: userId },
      {
        name: 'New Organization',
        slug: 'new-organization',
        timezone: 'Asia/Tehran',
        reason: 'Approved onboarding',
      },
      idempotencyKey,
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(ownerCalled, false);
});

test('organization creation accepts no reason and still forwards trusted command metadata', async () => {
  let received: unknown;
  const instance = controller(
    {
      evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }),
    },
    {
      createOrganization: async (input) => {
        received = input;
        return organization(firstOrganizationId);
      },
    },
  );

  const result = await instance.createOrganization(
    { id: userId },
    { name: 'New Organization', slug: 'new-organization', timezone: 'Asia/Tehran' },
    idempotencyKey,
    request(),
  );

  assert.deepEqual(received, {
    name: 'New Organization',
    slug: 'new-organization',
    timezone: 'Asia/Tehran',
  });
  assert.equal(result.data.id, firstOrganizationId);
});

test('branch status writes authorize the exact parent/branch scope and pass trusted actor metadata', async () => {
  const authorizationRequests: Array<{ permission: string; scope: unknown; resource?: unknown }> =
    [];
  let mutation:
    | { organizationId: string; branchId: string; version: number; input: unknown; meta: unknown }
    | undefined;
  const instance = controller(
    {
      evaluateAuthorization: async (_actor, _session, authorization) => {
        authorizationRequests.push(authorization);
        return { allowed: true, policyVersion: 1, catalogVersion: 1 };
      },
    },
    {
      changeBranchStatus: async (organizationId, id, version, input, meta) => {
        mutation = { organizationId, branchId: id, version, input, meta };
        return {
          ...organization(firstOrganizationId),
          id,
          organizationId,
          address: 'Main street',
          city: 'Tehran',
          openingHours: {},
        };
      },
    },
  );

  const branchResult = await instance.changeBranchStatus(
    { id: userId },
    firstOrganizationId,
    branchId,
    '"7"',
    idempotencyKey,
    { status: 'suspended', reason: 'Temporary maintenance' },
    request(),
  );
  assert.equal(authorizationRequests[0]?.permission, 'branch.deactivate');
  assert.deepEqual(authorizationRequests[0]?.scope, {
    type: 'branch',
    organizationId: firstOrganizationId,
    branchId,
  });
  assert.deepEqual(mutation, {
    organizationId: firstOrganizationId,
    branchId,
    version: 7,
    input: { status: 'suspended', reason: 'Temporary maintenance' },
    meta: { actorUserId: userId, correlationId, idempotencyKey },
  });
  assert.equal(branchResult.data.id, branchId);
  assert.equal('legacyCreatedAtLocal' in branchResult.data, false);
});
