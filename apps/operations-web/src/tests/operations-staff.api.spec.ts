import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptMyStaffInvitation,
  changeOperationsStaffRole,
  listOperationsRoles,
  listOperationsStaff,
  type OperationsStaffMember,
} from '../lib/api/operations-staff';

const organizationId = '11111111-1111-4111-8111-111111111111';
const invitationId = '22222222-2222-4222-8222-222222222222';

async function withFetchStub<T>(
  stub: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function successResponse(data: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ status: 'success', data, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('staff roster request carries only the selected organization scope and preserves the IAM page envelope', async () => {
  const scope = { type: 'organization' as const, organizationId };
  await withFetchStub((input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/operations/staff');
    assert.equal(url.searchParams.get('scopeType'), 'organization');
    assert.equal(url.searchParams.get('organizationId'), organizationId);
    assert.equal(url.searchParams.get('branchId'), null);
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.cache, 'no-store');
    return successResponse({ data: [], nextCursor: null, policyVersion: 9 });
  }, async () => {
    const page = await listOperationsStaff(scope);
    assert.deepEqual(page, { data: [], nextCursor: null, policyVersion: 9 });
  });
});

test('role pagination preserves the Gateway top-level cursor without inventing a nested envelope', async () => {
  const role = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Branch operator',
    scope: { type: 'organization' as const, organizationId },
    permissionKeys: ['staff.read'],
    systemManaged: false,
    status: 'active' as const,
    version: 1,
  };
  await withFetchStub((input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/operations/roles');
    assert.equal(url.searchParams.get('scopeType'), 'organization');
    assert.equal(url.searchParams.get('cursor'), invitationId);
    return successResponse([role], { nextCursor: invitationId });
  }, async () => {
    const page = await listOperationsRoles(
      { type: 'organization', organizationId },
      invitationId,
    );
    assert.deepEqual(page, { data: [role], nextCursor: invitationId });
  });
});

test('acceptance sends an idempotency key but never accepts a client-provided phone number', async () => {
  await withFetchStub((input, init) => {
    assert.equal(String(input), `http://localhost:4000/api/v1/operations/staff/invitations/${invitationId}/accept`);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'retry-key-0123456789');
    return successResponse({ data: { membershipId: invitationId, status: 'active' }, policyVersion: 10 });
  }, async () => {
    await acceptMyStaffInvitation(invitationId, 'retry-key-0123456789');
  });
});

test('role change uses the membership version precondition, reason, and idempotency header', async () => {
  const member: OperationsStaffMember = {
    membershipId: invitationId,
    userId: '44444444-4444-4444-8444-444444444444',
    status: 'active',
    scope: { type: 'organization', organizationId },
    role: {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Current role',
      scope: { type: 'organization', organizationId },
      permissionKeys: ['staff.read'],
      systemManaged: false,
      status: 'active',
      version: 1,
    },
    version: 7,
  };
  await withFetchStub((input, init) => {
    assert.equal(String(input), `http://localhost:4000/api/v1/operations/staff/${invitationId}`);
    assert.equal(init?.method, 'PATCH');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('if-match'), '"7"');
    assert.equal(headers.get('idempotency-key'), 'retry-key-0123456789');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      roleId: '66666666-6666-4666-8666-666666666666',
      reason: 'Coverage change',
    });
    return successResponse({ data: { membershipId: invitationId }, policyVersion: 11 });
  }, async () => {
    await changeOperationsStaffRole(
      member,
      '66666666-6666-4666-8666-666666666666',
      'Coverage change',
      'retry-key-0123456789',
    );
  });
});
