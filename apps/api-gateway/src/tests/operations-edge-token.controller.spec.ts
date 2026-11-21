import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';
import { OperationsEdgeTokenController } from '../interfaces/http/operations-edge-token.controller.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';

function managementSession(): Session {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId,
    audience: 'management',
    tokenHash: 'persisted-session-hash',
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    mfaVerifiedAt: null,
    mfaFactorVersion: null,
    mfaMethod: null,
    lastActivityAt: Date.now(),
  };
}

function request(session: Session | undefined): AuthenticatedRequest {
  return {
    ...(session ? { session } : {}),
    requestId: 'request-id',
    correlationId,
  } as AuthenticatedRequest;
}

const body = {
  branchId,
  permissionKeys: ['card.assign', 'customer.lookup.limited'] as const,
};

test('operator token exchange derives branch scope from the owner and actor from the management session', async () => {
  let activeBranchRequest: string | undefined;
  let issueCall: unknown;
  const organizationBranch = {
    getActiveBranch: async (requestedBranchId: string) => {
      activeBranchRequest = requestedBranchId;
      return { id: branchId, organizationId, status: 'active' };
    },
  } as unknown as OrganizationBranchClient;
  const identityAccess = {
    issueEdgeOperatorToken: async (...args: unknown[]) => {
      issueCall = args;
      return {
        token: 'ephemeral-edge-operator-token-value-0123456789',
        tokenId: '66666666-6666-4666-8666-666666666666',
        permissionKeys: [...body.permissionKeys],
        branchId,
        expiresAt: '2026-11-21T14:00:00.000Z',
        policyVersion: 3,
        catalogVersion: 2,
      };
    },
  } as unknown as IdentityAccessClient;
  const controller = new OperationsEdgeTokenController(organizationBranch, identityAccess);
  const session = managementSession();

  const result = await controller.issue({ id: userId }, body as never, request(session));

  assert.equal(activeBranchRequest, branchId);
  assert.deepEqual(issueCall, [
    userId,
    session,
    { type: 'branch', organizationId, branchId },
    [...body.permissionKeys],
    correlationId,
  ]);
  assert.deepEqual(result, {
    status: 'success',
    data: {
      token: 'ephemeral-edge-operator-token-value-0123456789',
      tokenId: '66666666-6666-4666-8666-666666666666',
      permissionKeys: [...body.permissionKeys],
      branchId,
      expiresAt: '2026-11-21T14:00:00.000Z',
      policyVersion: 3,
      catalogVersion: 2,
    },
    meta: { requestId: 'request-id', correlationId },
  });
});

test('operator token exchange rejects missing or customer sessions before reading branch scope', async () => {
  let branchLookups = 0;
  const controller = new OperationsEdgeTokenController(
    {
      getActiveBranch: async () => {
        branchLookups += 1;
        return { id: branchId, organizationId, status: 'active' };
      },
    } as unknown as OrganizationBranchClient,
    {
      issueEdgeOperatorToken: async () =>
        assert.fail('IAM must not issue without management session'),
    } as never,
  );

  await assert.rejects(
    controller.issue({ id: userId }, body as never, request(undefined)),
    (error: unknown) => error instanceof DomainError && error.code === 'UNAUTHENTICATED',
  );
  await assert.rejects(
    controller.issue(
      { id: userId },
      body as never,
      request({ ...managementSession(), audience: 'customer' }),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'UNAUTHENTICATED',
  );
  assert.equal(branchLookups, 0);
});
