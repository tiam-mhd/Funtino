import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import { OperationsAccessController } from '../interfaces/http/operations-access.controller.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import type { AuthService } from '../application/auth/auth.service.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const inactiveOrganizationId = '44444444-4444-4444-8444-444444444444';
const otherBranchId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherOrganizationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const mismatchedParentId = '99999999-9999-4999-8999-999999999998';
const verifiedPhone = '+989121234567';
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
    audience: 'management',
    lastActivityAt: Date.now(),
  };
}

function request(): AuthenticatedRequest {
  return {
    session: session(),
    requestId: 'request-operations-staff',
    correlationId,
  } as AuthenticatedRequest;
}

function invitation(
  id: string,
  scope:
    | { type: 'organization'; organizationId: string }
    | { type: 'branch'; organizationId: string; branchId: string }
    | { type: 'global' },
) {
  return {
    id,
    scope,
    role: {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'مدیر شیفت',
      scope,
      permissionKeys: ['staff.read'],
      systemManaged: false,
      status: 'active' as const,
      version: 1,
    },
    maskedPhone: '+98••••••4567',
    expiresAt: '2026-10-08T10:00:00.000Z',
    roleChanged: false,
  };
}

function makeController(
  pending: IdentityAccessClient['pendingInvitations'],
  owner: Partial<OrganizationBranchClient>,
) {
  return new OperationsAccessController(
    { pendingInvitations: pending } as unknown as IdentityAccessClient,
    { getMe: async () => ({ phoneE164: verifiedPhone }) } as unknown as AuthService,
    owner as OrganizationBranchClient,
  );
}

test('personal invitations use the verified session phone and show live owner names', async () => {
  const branchInvitationId = '88888888-8888-4888-8888-888888888888';
  const organizationInvitationId = '99999999-9999-4999-8999-999999999999';
  const pending = (async (
    receivedUserId: string,
    receivedSession: Session,
    receivedPhone: string,
    receivedCorrelationId: string,
  ) => {
    assert.equal(receivedUserId, userId);
    assert.equal(receivedSession.id, session().id);
    assert.equal(receivedPhone, verifiedPhone);
    assert.equal(receivedCorrelationId, correlationId);
    return {
      data: [
        invitation(branchInvitationId, { type: 'branch', organizationId, branchId }),
        invitation(organizationInvitationId, { type: 'organization', organizationId }),
      ],
    };
  }) as unknown as IdentityAccessClient['pendingInvitations'];
  const controller = makeController(pending, {
    getOrganization: async (id) =>
      ({
        id,
        name: 'مجموعه آفتاب',
        status: 'active',
      }) as Awaited<ReturnType<OrganizationBranchClient['getOrganization']>>,
    getOrganizationBranch: async (parentId, id) =>
      ({
        id,
        organizationId: parentId,
        name: 'شعبه مرکزی',
        status: 'active',
      }) as Awaited<ReturnType<OrganizationBranchClient['getOrganizationBranch']>>,
  });

  const response = await controller.pendingInvitations({ id: userId }, request());
  assert.equal(response.status, 'success');
  assert.deepEqual(
    response.data.data.map((item) => ({
      organizationName: item.organizationName,
      branchName: item.branchName,
      scopeStatus: item.scopeStatus,
    })),
    [
      { organizationName: 'مجموعه آفتاب', branchName: 'شعبه مرکزی', scopeStatus: 'active' },
      { organizationName: 'مجموعه آفتاب', branchName: null, scopeStatus: 'active' },
    ],
  );
  assert.equal(JSON.stringify(response).includes(verifiedPhone), false);
});

test('inactive and global invitation scopes are never marked acceptable in Operations Web', async () => {
  const records = [
    invitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      type: 'organization',
      organizationId: inactiveOrganizationId,
    }),
    invitation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { type: 'global' }),
  ];
  const controller = makeController(
    (async () => ({ data: records })) as unknown as IdentityAccessClient['pendingInvitations'],
    {
      getOrganization: async (id) =>
        ({
          id,
          name: 'مجموعه تعلیق‌شده',
          status: 'suspended',
        }) as Awaited<ReturnType<OrganizationBranchClient['getOrganization']>>,
    },
  );

  const response = await controller.pendingInvitations({ id: userId }, request());
  assert.equal(response.data.data[0]?.scopeStatus, 'inactive');
  assert.equal(response.data.data[1]?.scopeStatus, 'system_only');
  assert.equal(response.data.data[1]?.organizationName, null);
  assert.equal(response.data.data[1]?.branchName, null);
});

test('missing, unavailable or mismatched owner records produce no label and cannot be accepted', async () => {
  const records = [
    invitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      type: 'organization',
      organizationId,
    }),
    invitation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      type: 'organization',
      organizationId: inactiveOrganizationId,
    }),
    invitation('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      type: 'branch',
      organizationId: otherOrganizationId,
      branchId: otherBranchId,
    }),
  ];
  const controller = makeController(
    (async () => ({ data: records })) as unknown as IdentityAccessClient['pendingInvitations'],
    {
      getOrganization: async (id) => {
        if (id === organizationId) throw new DomainError('NOT_FOUND', 'Not found.');
        if (id === otherOrganizationId) {
          return {
            id,
            name: 'مجموعه اصلی',
            status: 'active',
          } as Awaited<ReturnType<OrganizationBranchClient['getOrganization']>>;
        }
        throw new DomainError('DEPENDENCY_UNAVAILABLE', 'Unavailable.');
      },
      getOrganizationBranch: async () =>
        ({
          id: otherBranchId,
          organizationId: mismatchedParentId,
          name: 'شعبه با والد ناسازگار',
          status: 'active',
        }) as Awaited<ReturnType<OrganizationBranchClient['getOrganizationBranch']>>,
    },
  );

  const response = await controller.pendingInvitations({ id: userId }, request());
  assert.deepEqual(
    response.data.data.map(({ organizationName, scopeStatus }) => ({
      organizationName,
      scopeStatus,
    })),
    [
      { organizationName: null, scopeStatus: 'unavailable' },
      { organizationName: null, scopeStatus: 'unavailable' },
      { organizationName: 'مجموعه اصلی', scopeStatus: 'unavailable' },
    ],
  );
  assert.equal(response.data.data[2]?.branchName, null);
});
