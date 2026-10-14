import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import { OperationsCardsController } from '../interfaces/http/operations-cards.controller.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';
import type { WalletCardInventory, WalletClient } from '../infrastructure/wallet/wallet.client.js';
import type { CustomerHouseholdClient } from '../infrastructure/customer-household/customer-household.client.js';
import type { FuntinoStorePort } from '../infrastructure/store/funtino-store.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const cardId = '44444444-4444-4444-8444-444444444444';
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
    audience: 'management',
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

function card(): WalletCardInventory {
  return {
    id: cardId,
    organizationId,
    branchId,
    maskedIdentifier: '•••• 1029',
    status: 'in_stock',
    verificationStatus: 'unknown',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

function controller(
  access: Partial<IdentityAccessClient> = {},
  owner: Partial<OrganizationBranchClient> = {},
  wallet: Partial<WalletClient> = {},
  households: Partial<CustomerHouseholdClient> = {},
  store: Partial<FuntinoStorePort> = {},
) {
  return new OperationsCardsController(
    access as IdentityAccessClient,
    owner as OrganizationBranchClient,
    wallet as WalletClient,
    households as CustomerHouseholdClient,
    store as FuntinoStorePort,
  );
}

function activeOwner() {
  return {
    getOrganization: async () => ({ status: 'active' }) as never,
    getOrganizationBranch: async () =>
      ({
        id: branchId,
        organizationId,
        name: 'Central',
        city: 'Tehran',
        status: 'active',
      }) as never,
  };
}

test('card listing requires exact branch permission and returns owner data with server-evaluated capabilities', async () => {
  const permissions: string[] = [];
  const result = await controller(
    {
      evaluateAuthorization: async (_user, _session, input) => {
        permissions.push(input.permission);
        return {
          allowed: input.permission === 'card.inventory.read',
          policyVersion: 2,
          catalogVersion: 1,
        };
      },
    },
    activeOwner(),
    { listCards: async () => ({ items: [card()], nextCursor: null }) },
  ).listCards({ id: userId }, organizationId, branchId, { pageSize: 25 }, request());

  assert.deepEqual(result.data.items, [card()]);
  assert.deepEqual(result.data.capabilities, {
    canManage: false,
    canAssign: false,
    canTransfer: false,
    canUnassign: false,
    canLookupCustomer: false,
  });
  assert.equal(result.nextCursor, null);
  assert.deepEqual(permissions, [
    'card.inventory.read',
    'card.inventory.manage',
    'card.assign',
    'card.transfer',
    'card.unassign',
    'customer.lookup.limited',
  ]);
});

test('card capabilities expose permission state without presenting card commands as MFA step-up actions', async () => {
  const result = await controller(
    {
      evaluateAuthorization: async (_user, _session, input) => ({
        allowed: input.permission === 'card.inventory.read',
        ...(input.permission === 'card.assign' ? { reason: 'step_up_required' as const } : {}),
        policyVersion: 2,
        catalogVersion: 1,
      }),
    },
    activeOwner(),
    { listCards: async () => ({ items: [card()], nextCursor: null }) },
  ).listCards({ id: userId }, organizationId, branchId, { pageSize: 25 }, request());

  assert.equal(result.data.capabilities.canAssign, false);
  assert.equal('requiresStepUp' in result.data.capabilities, false);
});

test('denied inventory read stops before owner and Wallet calls', async () => {
  let ownerRead = false;
  let walletRead = false;
  await assert.rejects(
    controller(
      {
        evaluateAuthorization: async () => ({
          allowed: false,
          policyVersion: 1,
          catalogVersion: 1,
        }),
      },
      {
        getOrganization: async () => {
          ownerRead = true;
          return { status: 'active' } as never;
        },
      },
      {
        listCards: async () => {
          walletRead = true;
          return { items: [], nextCursor: null };
        },
      },
    ).listCards({ id: userId }, organizationId, branchId, { pageSize: 25 }, request()),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(ownerRead, false);
  assert.equal(walletRead, false);
});

test('customer household lookup is rate limited by actor and branch before identity resolution', async () => {
  let householdLookupCalled = false;
  let auditAction = '';
  const instance = controller(
    { evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }) },
    activeOwner(),
    {},
    {
      listHouseholdsForUser: async () => {
        householdLookupCalled = true;
        return [];
      },
    },
    {
      consumeOperationsCustomerLookupQuota: async (input) => {
        assert.equal(input.actorUserId, userId);
        assert.equal(input.branchId, branchId);
        assert.equal(input.maxRequests, 30);
        return 31;
      },
      recordAudit: async (_actor, action) => {
        auditAction = action;
      },
    },
  );

  await assert.rejects(
    instance.lookupHouseholds(
      { id: userId },
      organizationId,
      branchId,
      { phone: '+989121234567' },
      request(),
    ),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof error.getStatus === 'function' &&
      error.getStatus() === 429,
  );
  assert.equal(householdLookupCalled, false);
  assert.equal(auditAction, 'operations.customer.household_lookup_rate_limited');
});

test('customer lookup attempt is audited without the phone before calling the household owner', async () => {
  const auditEvents: unknown[][] = [];
  const instance = controller(
    { evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }) },
    activeOwner(),
    {},
    {
      listHouseholdsForUser: async () => {
        throw new Error('household owner unavailable');
      },
    },
    {
      consumeOperationsCustomerLookupQuota: async () => 1,
      getUserByPhone: async () => ({ id: userId }) as never,
      recordAudit: async (...args) => {
        auditEvents.push(args);
      },
    },
  );

  await assert.rejects(
    instance.lookupHouseholds(
      { id: userId },
      organizationId,
      branchId,
      { phone: '+989121234567' },
      request(),
    ),
    /household owner unavailable/,
  );
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[0][1], 'operations.customer.household_lookup');
  assert.equal(auditEvents[0][2], 'customer_lookup');
  assert.equal(auditEvents[1][1], 'operations.customer.household_lookup');
  assert.equal(auditEvents[1][2], 'customer_user');
  assert.equal(auditEvents[1][3], userId);
  assert.equal(JSON.stringify(auditEvents).includes('+989121234567'), false);
});

test('inactive or mismatched owner branch blocks the inventory query', async () => {
  let walletCalled = false;
  const instance = controller(
    { evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }) },
    {
      getOrganization: async () => ({ status: 'active' }) as never,
      getOrganizationBranch: async () =>
        ({ id: branchId, organizationId: userId, status: 'active' }) as never,
    },
    {
      listCards: async () => {
        walletCalled = true;
        return { items: [], nextCursor: null };
      },
    },
  );
  await assert.rejects(
    instance.listCards({ id: userId }, organizationId, branchId, { pageSize: 25 }, request()),
    (error: unknown) => error instanceof DomainError && error.code === 'NOT_FOUND',
  );
  assert.equal(walletCalled, false);
});

test('registration requires manage permission, active branch, and forwards trusted idempotency metadata', async () => {
  let authorization: unknown;
  let metadata: unknown;
  const result = await controller(
    {
      evaluateAuthorization: async (_user, _session, input) => {
        authorization = input;
        return { allowed: true, policyVersion: 1, catalogVersion: 1 };
      },
    },
    activeOwner(),
    {
      registerCard: async (_organization, _branch, input, meta) => {
        assert.deepEqual(input, {
          externalCardId: 'private-physical-id-1029',
          reason: 'Initial branch stock registration',
        });
        metadata = meta;
        return card();
      },
    },
  ).registerCard(
    { id: userId },
    organizationId,
    branchId,
    idempotencyKey,
    { externalCardId: 'private-physical-id-1029', reason: 'Initial branch stock registration' },
    request(),
  );
  assert.deepEqual(authorization, {
    permission: 'card.inventory.manage',
    scope: { type: 'branch', organizationId, branchId },
    resource: { type: 'branch', id: branchId },
  });
  assert.deepEqual(metadata, { actorUserId: userId, correlationId, idempotencyKey });
  assert.equal(result.data.maskedIdentifier, card().maskedIdentifier);
});

test('status mutation requires a quoted version and sends exact card resource and audit metadata', async () => {
  let authorization: unknown;
  let args: unknown[] = [];
  const result = await controller(
    {
      evaluateAuthorization: async (_user, _session, input) => {
        authorization = input;
        return { allowed: true, policyVersion: 1, catalogVersion: 1 };
      },
    },
    activeOwner(),
    {
      changeCardStatus: async (...values) => {
        args = values;
        return { ...card(), status: 'blocked', version: 2 };
      },
    },
  ).changeCardStatus(
    { id: userId },
    organizationId,
    branchId,
    cardId,
    '"1"',
    idempotencyKey,
    { status: 'blocked', reason: 'Card reported lost by customer' },
    request(),
  );
  assert.deepEqual(authorization, {
    permission: 'card.inventory.manage',
    scope: { type: 'branch', organizationId, branchId },
    resource: { type: 'card', id: cardId },
  });
  assert.deepEqual(args, [
    organizationId,
    branchId,
    cardId,
    1,
    { status: 'blocked', reason: 'Card reported lost by customer' },
    { actorUserId: userId, correlationId, idempotencyKey },
  ]);
  assert.equal(result.data.version, 2);
});

test('commands fail without an authenticated session or valid idempotency UUID', async () => {
  let walletCalled = false;
  const instance = controller(
    { evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }) },
    activeOwner(),
    {
      registerCard: async () => {
        walletCalled = true;
        return card();
      },
    },
  );
  await assert.rejects(
    instance.registerCard(
      { id: userId },
      organizationId,
      branchId,
      idempotencyKey,
      { externalCardId: 'private-physical-id-1029', reason: 'Initial branch stock registration' },
      request(false),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'UNAUTHENTICATED',
  );
  await assert.rejects(
    instance.registerCard(
      { id: userId },
      organizationId,
      branchId,
      'invalid',
      { externalCardId: 'private-physical-id-1029', reason: 'Initial branch stock registration' },
      request(),
    ),
  );
  assert.equal(walletCalled, false);
});

test('assignment revalidates the exact phone against the household owner and forwards idempotent scope metadata', async () => {
  let walletArguments: unknown[] = [];
  let auditArguments: unknown[] = [];
  const householdId = '88888888-8888-4888-8888-888888888888';
  const result = await controller(
    {
      evaluateAuthorization: async (_user, _session, input) => ({
        allowed: input.permission === 'card.assign',
        policyVersion: 1,
        catalogVersion: 1,
      }),
    },
    activeOwner(),
    {
      assignCard: async (...args) => {
        walletArguments = args;
        return {
          id: '99999999-9999-4999-8999-999999999999',
          cardId,
          organizationId,
          branchId,
          householdId,
          maskedIdentifier: '•••• 1029',
          status: 'assigned',
          verificationStatus: 'verified',
          assignedAt: '2026-10-01T10:00:00.000Z',
        };
      },
    },
    {
      listHouseholdsForUser: async (foundUserId) => {
        assert.equal(foundUserId, userId);
        return [
          {
            id: householdId,
            name: 'خانواده‌ی الف',
            status: 'active',
            version: 1,
            createdAt: '2026-10-01T10:00:00.000Z',
            members: [],
          },
        ];
      },
    },
    {
      getUserByPhone: async (phone) => {
        assert.equal(phone, '+989121234567');
        return { id: userId } as never;
      },
      recordAudit: async (...args) => {
        auditArguments = args;
      },
    },
  ).assignCard(
    { id: userId },
    organizationId,
    branchId,
    cardId,
    idempotencyKey,
    { phone: '09121234567', householdId, reason: 'Customer presented verified phone' },
    request(),
  );
  assert.equal(result.data.householdId, householdId);
  assert.deepEqual(walletArguments, [
    organizationId,
    branchId,
    cardId,
    { householdId, reason: 'Customer presented verified phone' },
    { actorUserId: userId, correlationId, idempotencyKey },
  ]);
  assert.equal(auditArguments[0], userId);
  assert.equal(auditArguments[1], 'operations.customer.household_lookup');
  assert.equal(auditArguments[2], 'customer_user');
  assert.equal(auditArguments[3], userId);
  assert.equal(auditArguments.includes('09121234567'), false);
});

test('assignment rejects a household not returned by the phone owner before Wallet mutation', async () => {
  let walletCalled = false;
  const instance = controller(
    { evaluateAuthorization: async () => ({ allowed: true, policyVersion: 1, catalogVersion: 1 }) },
    activeOwner(),
    {
      assignCard: async () => {
        walletCalled = true;
        return {} as never;
      },
    },
    { listHouseholdsForUser: async () => [] },
    { getUserByPhone: async () => ({ id: userId }) as never, recordAudit: async () => undefined },
  );
  await assert.rejects(
    instance.assignCard(
      { id: userId },
      organizationId,
      branchId,
      cardId,
      idempotencyKey,
      {
        phone: '09121234567',
        householdId: '88888888-8888-4888-8888-888888888888',
        reason: 'Requested customer card assignment',
      },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(walletCalled, false);
});
