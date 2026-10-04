import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import { OperationsScopeController } from '../interfaces/http/operations-scope.controller.js';
import { AuthService } from '../application/auth/auth.service.js';
import { InMemoryFuntinoStore } from '../infrastructure/store/funtino-store.js';
import type {
  IdentityAccessClient,
  OperationsAccessContext,
} from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const inheritedBranchId = '99999999-9999-4999-8999-999999999999';
const suspendedBranchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const inactiveOrganizationId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';

function session(): Session {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    userId,
    tokenHash: 'session-hash',
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    mfaVerifiedAt: null,
    mfaFactorVersion: null,
    mfaMethod: null,
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

function membership(
  scope:
    | { type: 'global' }
    | { type: 'organization'; organizationId: string }
    | { type: 'branch'; organizationId: string; branchId: string },
  options: {
    status?: 'pending' | 'active' | 'suspended' | 'revoked';
    roleStatus?: 'active' | 'disabled';
  } = {},
) {
  return {
    membershipId: `membership-${scope.type}-${'branchId' in scope ? scope.branchId : 'organizationId' in scope ? scope.organizationId : 'global'}`,
    status: options.status ?? 'active',
    scope,
    role: {
      id: 'role-id',
      name: 'operator',
      scope,
      permissionKeys: ['card.inventory.read'],
      systemManaged: false,
      status: options.roleStatus ?? 'active',
      version: 1,
    },
    version: 1,
  };
}

function organization(id: string, status: 'active' | 'suspended' | 'archived' = 'active') {
  return {
    id,
    name: `مجموعه ${id.slice(0, 4)}`,
    slug: `organization-${id.slice(0, 4)}`,
    timezone: 'Asia/Tehran',
    status,
    version: 1,
    legacyCreatedAtLocal: null,
    legacyUpdatedAtLocal: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
  };
}

function branch(
  id: string,
  parentOrganizationId: string,
  status: 'active' | 'suspended' | 'archived' = 'active',
) {
  return {
    ...organization(parentOrganizationId, 'active'),
    id,
    organizationId: parentOrganizationId,
    name: `شعبه ${id.slice(0, 4)}`,
    slug: `branch-${id.slice(0, 4)}`,
    address: 'نشانی آزمایشی',
    city: 'تهران',
    openingHours: {},
    status,
  };
}

function context(memberships: ReturnType<typeof membership>[]): OperationsAccessContext {
  return { memberships, policyVersion: 7, catalogVersion: 1 } as unknown as OperationsAccessContext;
}

function makeController(
  access: Partial<IdentityAccessClient>,
  owner: Partial<OrganizationBranchClient>,
  recordSelection: (...args: unknown[]) => Promise<void> = async () => undefined,
) {
  return new OperationsScopeController(
    access as IdentityAccessClient,
    {
      listOrganizationBranches: async () => ({ items: [], nextCursor: null }),
      ...owner,
    } as OrganizationBranchClient,
    { recordOperationsScopeSelection: recordSelection } as unknown as AuthService,
  );
}

test('scope list contains only active tenant memberships whose owner records and parent organization are active', async () => {
  const activeContext = context([
    membership({ type: 'organization', organizationId }),
    membership({ type: 'organization', organizationId }),
    membership({ type: 'branch', organizationId, branchId }),
    membership({ type: 'organization', organizationId: inactiveOrganizationId }),
    membership(
      { type: 'organization', organizationId: '77777777-7777-4777-8777-777777777777' },
      { status: 'suspended' },
    ),
    membership(
      { type: 'organization', organizationId: '88888888-8888-4888-8888-888888888888' },
      { roleStatus: 'disabled' },
    ),
    membership({ type: 'global' }),
  ]);
  const ownerReads: string[] = [];
  const instance = makeController(
    { currentAccessContext: async () => activeContext },
    {
      getOrganization: async (id) => {
        ownerReads.push(`organization:${id}`);
        return organization(id, id === inactiveOrganizationId ? 'suspended' : 'active') as never;
      },
      getOrganizationBranch: async (parentId, id) => {
        ownerReads.push(`branch:${parentId}:${id}`);
        return branch(id, parentId) as never;
      },
      listOrganizationBranches: async (id) => {
        ownerReads.push(`branches:${id}`);
        return {
          items: [
            branch(branchId, id),
            branch(inheritedBranchId, id),
            branch(suspendedBranchId, id, 'suspended'),
          ] as never,
          nextCursor: null,
        };
      },
    },
  );

  const result = await instance.listScopes({ id: userId }, request());
  assert.equal(result.data.policyVersion, 7);
  assert.deepEqual(
    result.data.items
      .map((item) => item.scope)
      .map((scope) => JSON.stringify(scope))
      .sort(),
    [
      { type: 'organization', organizationId },
      { type: 'branch', organizationId, branchId },
      { type: 'branch', organizationId, branchId: inheritedBranchId },
    ]
      .map((scope) => JSON.stringify(scope))
      .sort(),
  );
  assert.equal(result.data.items[0]?.organization.name, `مجموعه ${organizationId.slice(0, 4)}`);
  assert.deepEqual(
    ownerReads.sort(),
    [
      `organization:${inactiveOrganizationId}`,
      `organization:${organizationId}`,
      `branches:${organizationId}`,
    ].sort(),
  );
});

test('organization scope listing follows the owner branch cursor through every page', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    branch(`10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, organizationId),
  );
  const finalBranchId = '20000000-0000-4000-8000-000000000000';
  const requestedCursors: Array<string | undefined> = [];
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'organization', organizationId })]),
    },
    {
      getOrganization: async (id) => organization(id) as never,
      listOrganizationBranches: async (_id, page) => {
        requestedCursors.push(page?.cursor);
        return page?.cursor
          ? { items: [branch(finalBranchId, organizationId)] as never, nextCursor: null }
          : { items: firstPage as never, nextCursor: firstPage.at(-1)?.id ?? null };
      },
    },
  );

  const result = await instance.listScopes({ id: userId }, request());
  assert.deepEqual(requestedCursors, [undefined, firstPage.at(-1)?.id]);
  assert.equal(result.data.items.length, 102);
  assert.ok(
    result.data.items.some(
      (item) => item.scope.type === 'branch' && item.scope.branchId === finalBranchId,
    ),
  );
});

test('organization scope listing fails closed when the owner cursor is malformed', async () => {
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'organization', organizationId })]),
    },
    {
      getOrganization: async (id) => organization(id) as never,
      listOrganizationBranches: async () => ({
        items: [branch(branchId, organizationId)] as never,
        nextCursor: branchId,
      }),
    },
  );

  await assert.rejects(
    instance.listScopes({ id: userId }, request()),
    (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
  );
});

test('a branch inherited from an active organization membership can be selected and is audited', async () => {
  let audit: unknown[] | undefined;
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'organization', organizationId })]),
    },
    {
      getOrganization: async (id) => organization(id) as never,
      getOrganizationBranch: async (parentId, id) => branch(id, parentId) as never,
    },
    async (...args) => {
      audit = args;
    },
  );

  const result = await instance.selectScope(
    { id: userId },
    { scope: { type: 'branch', organizationId, branchId: inheritedBranchId } },
    request(),
  );
  assert.deepEqual(result.data.scope, {
    type: 'branch',
    organizationId,
    branchId: inheritedBranchId,
  });
  assert.deepEqual(audit, [
    userId,
    { type: 'branch', organizationId, branchId: inheritedBranchId },
    correlationId,
  ]);
});

test('branch selection rejects client-supplied scopes that are not in the current IAM membership context', async () => {
  let ownerCalled = false;
  let auditCalled = false;
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'branch', organizationId, branchId })]),
    },
    {
      getOrganization: async () => {
        ownerCalled = true;
        return organization(organizationId) as never;
      },
    },
    async () => {
      auditCalled = true;
    },
  );

  await assert.rejects(
    instance.selectScope(
      { id: userId },
      { scope: { type: 'branch', organizationId, branchId: inactiveOrganizationId } },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(ownerCalled, false);
  assert.equal(auditCalled, false);
});

test('selection rechecks active owner state and audits the selected branch only after validation', async () => {
  let audit: unknown[] | undefined;
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'branch', organizationId, branchId })]),
    },
    {
      getOrganization: async (id) => organization(id) as never,
      getOrganizationBranch: async (parentId, id) => branch(id, parentId) as never,
    },
    async (...args) => {
      audit = args;
    },
  );

  const result = await instance.selectScope(
    { id: userId },
    { scope: { type: 'branch', organizationId, branchId } },
    request(),
  );
  assert.deepEqual(result.data.scope, { type: 'branch', organizationId, branchId });
  assert.deepEqual(audit, [userId, { type: 'branch', organizationId, branchId }, correlationId]);
});

test('scope-selection audit persists the complete organization and branch scope without a schema migration', async () => {
  const store = new InMemoryFuntinoStore();
  const auth = new AuthService(store, {
    currentAccessContext: async () => ({ memberships: [], policyVersion: 1, catalogVersion: 1 }),
  } as never);

  await auth.recordOperationsScopeSelection(
    userId,
    { type: 'branch', organizationId, branchId },
    correlationId,
  );

  assert.deepEqual(store.audits.at(-1), {
    id: store.audits.at(-1)?.id,
    actorUserId: userId,
    action: 'operations.scope.selected',
    resourceType: 'branch',
    resourceId: branchId,
    organizationId,
    branchId,
    correlationId,
    reason: null,
    createdAt: store.audits.at(-1)?.createdAt,
  });
});

test('stale or suspended branch scopes are omitted and cannot be selected', async () => {
  const scopeContext = context([membership({ type: 'branch', organizationId, branchId })]);
  const owner = {
    getOrganization: async (id: string) => organization(id) as never,
    getOrganizationBranch: async (parentId: string, id: string) =>
      branch(id, parentId, 'suspended') as never,
  };
  const instance = makeController({ currentAccessContext: async () => scopeContext }, owner);

  const listed = await instance.listScopes({ id: userId }, request());
  assert.deepEqual(listed.data.items, []);
  await assert.rejects(
    instance.selectScope(
      { id: userId },
      { scope: { type: 'branch', organizationId, branchId } },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

test('a branch whose owner record has a different parent organization is rejected', async () => {
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'branch', organizationId, branchId })]),
    },
    {
      getOrganization: async (id) => organization(id) as never,
      getOrganizationBranch: async (_parentId, id) => branch(id, inactiveOrganizationId) as never,
    },
  );

  const listed = await instance.listScopes({ id: userId }, request());
  assert.deepEqual(listed.data.items, []);
  await assert.rejects(
    instance.selectScope(
      { id: userId },
      { scope: { type: 'branch', organizationId, branchId } },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

test('scope list fails closed when the owner service cannot confirm scope status', async () => {
  const instance = makeController(
    {
      currentAccessContext: async () =>
        context([membership({ type: 'organization', organizationId })]),
    },
    {
      getOrganization: async () => {
        throw new DomainError('DEPENDENCY_UNAVAILABLE', 'owner unavailable');
      },
    },
  );

  await assert.rejects(
    instance.listScopes({ id: userId }, request()),
    (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
  );
});
