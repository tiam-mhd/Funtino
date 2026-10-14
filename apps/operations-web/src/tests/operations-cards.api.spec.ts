import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeOperationsCardStatus,
  assignOperationsCard,
  cancelOperationsCardAssignment,
  listOperationsCardAssignments,
  listOperationsCards,
  lookupOperationsHouseholds,
  registerOperationsCard,
  transferOperationsCard,
  type OperationsCard,
  type OperationsCardAssignment,
} from '../lib/api/operations-cards';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const cursor = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const householdId = '66666666-6666-4666-8666-666666666666';
const assignmentId = '77777777-7777-4777-8777-777777777777';

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

function card(): OperationsCard {
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

function assignment(): OperationsCardAssignment {
  return {
    id: assignmentId,
    cardId,
    organizationId,
    branchId,
    householdId,
    maskedIdentifier: '•••• 1029',
    status: 'assigned',
    verificationStatus: 'verified',
    assignedAt: '2026-10-01T10:00:00.000Z',
  };
}

test('card inventory query uses selected branch, server status filter, and cursor', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/cards`,
      );
      assert.equal(url.searchParams.get('status'), 'in_stock');
      assert.equal(url.searchParams.get('cursor'), cursor);
      assert.equal(url.searchParams.get('pageSize'), '25');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return successResponse(
        {
          items: [card()],
          capabilities: {
            canManage: true,
            canAssign: true,
            canTransfer: true,
            canUnassign: true,
            canLookupCustomer: true,
          },
        },
        { nextCursor: null },
      );
    },
    async () => {
      const page = await listOperationsCards(organizationId, branchId, cursor, 'in_stock');
      assert.deepEqual(page, {
        data: [card()],
        nextCursor: null,
        capabilities: {
          canManage: true,
          canAssign: true,
          canTransfer: true,
          canUnassign: true,
          canLookupCustomer: true,
        },
      });
    },
  );
});

test('registration and status change send idempotency, and status uses optimistic version', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('idempotency-key'), idempotencyKey);
      if (init?.method === 'POST') {
        assert.equal(
          url.pathname,
          `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/cards`,
        );
        assert.deepEqual(JSON.parse(String(init.body)), {
          externalCardId: 'private-physical-id-1029',
          reason: 'Initial branch stock registration',
        });
        return successResponse(card());
      }
      assert.equal(init?.method, 'PATCH');
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/cards/${cardId}`,
      );
      assert.equal(headers.get('if-match'), '"1"');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        status: 'blocked',
        reason: 'Card reported lost by customer',
      });
      return successResponse({ ...card(), status: 'blocked', version: 2 });
    },
    async () => {
      await registerOperationsCard(
        organizationId,
        branchId,
        { externalCardId: 'private-physical-id-1029', reason: 'Initial branch stock registration' },
        idempotencyKey,
      );
      const result = await changeOperationsCardStatus(
        card(),
        { status: 'blocked', reason: 'Card reported lost by customer' },
        idempotencyKey,
      );
      assert.equal(result.status, 'blocked');
      assert.equal(result.version, 2);
    },
  );
});

test('branch assignment list and exact-phone lookup stay scoped and avoid putting phone in the URL', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/card-assignments')) {
        assert.equal(
          url.pathname,
          `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/card-assignments`,
        );
        assert.equal(url.searchParams.get('pageSize'), '50');
        return successResponse({ items: [assignment()] }, { nextCursor: null });
      }
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/customer-households/lookup`,
      );
      assert.equal(url.search, '');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { phone: '+989121234567' });
      return successResponse({
        items: [
          {
            householdId,
            householdName: 'خانواده‌ی الف',
            maskedPhone: '••••••4567',
            activeMemberCount: 2,
          },
        ],
      });
    },
    async () => {
      const page = await listOperationsCardAssignments(organizationId, branchId);
      assert.deepEqual(page, { items: [assignment()], nextCursor: null });
      const lookup = await lookupOperationsHouseholds(organizationId, branchId, '+989121234567');
      assert.equal(lookup.items[0]?.householdId, householdId);
    },
  );
});

test('assign, transfer and cancel commands use branch-scoped endpoints and idempotency keys', async () => {
  let requests = 0;
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('idempotency-key'), idempotencyKey);
      requests += 1;
      if (requests === 1) {
        assert.equal(
          url.pathname,
          `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/cards/${cardId}/assignments`,
        );
        assert.deepEqual(JSON.parse(String(init?.body)), {
          phone: '+989121234567',
          householdId,
          reason: 'Initial household assignment',
        });
        return successResponse(assignment());
      }
      if (requests === 2) {
        assert.equal(
          url.pathname,
          `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/card-assignments/${assignmentId}/transfer`,
        );
        return successResponse({
          ...assignment(),
          householdId: '88888888-8888-4888-8888-888888888888',
        });
      }
      assert.equal(
        url.pathname,
        `/api/v1/operations/organizations/${organizationId}/branches/${branchId}/card-assignments/${assignmentId}/cancel`,
      );
      return successResponse({ assignmentId, status: 'cancelled' });
    },
    async () => {
      await assignOperationsCard(
        card(),
        { phone: '+989121234567', householdId, reason: 'Initial household assignment' },
        idempotencyKey,
      );
      await transferOperationsCard(
        assignment(),
        {
          phone: '+989121234567',
          householdId: '88888888-8888-4888-8888-888888888888',
          reason: 'Household requested card transfer',
        },
        idempotencyKey,
      );
      await cancelOperationsCardAssignment(
        assignment(),
        { reason: 'Family returned the branch card' },
        idempotencyKey,
      );
    },
  );
  assert.equal(requests, 3);
});
