import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import type { DeviceIntegrationClient } from '../infrastructure/device-integration/device-integration.client.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';
import type { FuntinoStorePort } from '../infrastructure/store/funtino-store.js';
import { OperationsEdgePairingController } from '../interfaces/http/operations-edge-pairing.controller.js';
import { EdgeOperatorPairingRedemptionController } from '../interfaces/http/edge-operator-pairing-redemption.controller.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const pairingId = '55555555-5555-4555-8555-555555555555';
const correlationId = '66666666-6666-4666-8666-666666666666';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';
const pairingCode = 'ABCD2-EFGH3';
const permissionKeys = ['card.assign', 'customer.lookup.limited'] as const;

function managementSession(): Session {
  return {
    id: sessionId,
    userId,
    audience: 'management',
    tokenHash: 'stored-session-hash',
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

test('permission choices are evaluated by IAM for the active branch and reveal only allowed keys', async () => {
  const evaluated: unknown[][] = [];
  const controller = new OperationsEdgePairingController(
    {
      getActiveBranch: async () => ({ id: branchId, organizationId, status: 'active' }),
    } as unknown as OrganizationBranchClient,
    {
      evaluateAuthorization: async (...args: unknown[]) => {
        evaluated.push(args);
        const permission = (args[2] as { permission: string }).permission;
        return { allowed: permission === 'card.assign' };
      },
    } as unknown as IdentityAccessClient,
    {} as DeviceIntegrationClient,
  );
  const session = managementSession();
  const result = await controller.listPermissions({ id: userId }, { branchId }, request(session));
  assert.deepEqual(result.data, { branchId, permissionKeys: ['card.assign'] });
  assert.equal(evaluated.length, 10);
  assert.ok(evaluated.every((args) => args[1] === session));
  assert.ok(evaluated.every((args) => JSON.stringify(args[2]).includes(branchId)));
});

test('pairing approval checks every selected permission and forwards the live session plus idempotency key', async () => {
  let forwarded: unknown[] | undefined;
  const controller = new OperationsEdgePairingController(
    {
      getActiveBranch: async () => ({ id: branchId, organizationId, status: 'active' }),
    } as unknown as OrganizationBranchClient,
    { evaluateAuthorization: async () => ({ allowed: true }) } as unknown as IdentityAccessClient,
    {
      approveEdgeOperatorPairing: async (...args: unknown[]) => {
        forwarded = args;
        return {
          status: 'approved',
          branchId,
          permissionKeys: [...permissionKeys],
          expiresAt: '2026-11-22T12:05:00.000Z',
        };
      },
    } as unknown as DeviceIntegrationClient,
  );
  const session = managementSession();
  const result = await controller.approve(
    { id: userId },
    idempotencyKey,
    {
      code: pairingCode,
      branchId,
      permissionKeys: [...permissionKeys],
    },
    request(session),
  );
  assert.equal(result.data.status, 'approved');
  assert.deepEqual(forwarded, [
    {
      code: pairingCode,
      organizationId,
      branchId,
      managementSessionId: sessionId,
      permissionKeys: [...permissionKeys],
    },
    { actorUserId: userId, correlationId, idempotencyKey },
  ]);
});

test('pairing approval fails closed when IAM denies a requested permission or session is not management', async () => {
  let deviceCalls = 0;
  const controller = new OperationsEdgePairingController(
    {
      getActiveBranch: async () => ({ id: branchId, organizationId, status: 'active' }),
    } as unknown as OrganizationBranchClient,
    { evaluateAuthorization: async () => ({ allowed: false }) } as unknown as IdentityAccessClient,
    {
      approveEdgeOperatorPairing: async () => {
        deviceCalls += 1;
        return assert.fail('must not approve');
      },
    } as unknown as DeviceIntegrationClient,
  );
  await assert.rejects(
    controller.approve(
      { id: userId },
      idempotencyKey,
      {
        code: pairingCode,
        branchId,
        permissionKeys: [...permissionKeys],
      },
      request(managementSession()),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    controller.approve(
      { id: userId },
      idempotencyKey,
      {
        code: pairingCode,
        branchId,
        permissionKeys: [...permissionKeys],
      },
      request({ ...managementSession(), audience: 'customer' }),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'UNAUTHENTICATED',
  );
  assert.equal(deviceCalls, 0);
});

test('token redemption checks active management session and branch again before asking IAM', async () => {
  let issued = 0;
  const session = managementSession();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const controller = new EdgeOperatorPairingRedemptionController(
    {
      findActiveSessionById: async (id: string) => (id === sessionId ? session : undefined),
    } as unknown as FuntinoStorePort,
    {
      getActiveBranch: async () => ({ id: branchId, organizationId, status: 'active' }),
    } as unknown as OrganizationBranchClient,
    {
      issueEdgeOperatorToken: async (...args: unknown[]) => {
        issued += 1;
        assert.equal(args[0], userId);
        assert.equal(args[1], session);
        assert.deepEqual(args[2], { type: 'branch', organizationId, branchId });
        return {
          token: 'opaque-token-value-at-least-thirty-two-characters',
          tokenId: pairingId,
          permissionKeys: [...permissionKeys],
          branchId,
          expiresAt,
          policyVersion: 9,
          catalogVersion: 4,
        };
      },
    } as unknown as IdentityAccessClient,
  );
  const result = await controller.redeem(
    {
      pairingId,
      actorUserId: userId,
      managementSessionId: sessionId,
      organizationId,
      branchId,
      permissionKeys: [...permissionKeys],
    },
    request(session),
  );
  assert.equal(issued, 1);
  assert.deepEqual(result, {
    token: 'opaque-token-value-at-least-thirty-two-characters',
    tokenId: pairingId,
    organizationId,
    branchId,
    permissionKeys: [...permissionKeys],
    expiresAt,
    policyVersion: 9,
    catalogVersion: 4,
  });
});

test('token redemption rejects an expired or overlong IAM token', async () => {
  for (const expiresAt of [
    new Date(Date.now() - 1_000).toISOString(),
    new Date(Date.now() + 5 * 60_000 + 1_000).toISOString(),
  ]) {
    const controller = new EdgeOperatorPairingRedemptionController(
      { findActiveSessionById: async () => managementSession() } as unknown as FuntinoStorePort,
      {
        getActiveBranch: async () => ({ id: branchId, organizationId, status: 'active' }),
      } as unknown as OrganizationBranchClient,
      {
        issueEdgeOperatorToken: async () => ({
          token: 'opaque-token-value-at-least-thirty-two-characters',
          tokenId: pairingId,
          permissionKeys: [...permissionKeys],
          branchId,
          expiresAt,
          policyVersion: 9,
          catalogVersion: 4,
        }),
      } as unknown as IdentityAccessClient,
    );
    await assert.rejects(
      controller.redeem(
        {
          pairingId,
          actorUserId: userId,
          managementSessionId: sessionId,
          organizationId,
          branchId,
          permissionKeys: [...permissionKeys],
        },
        request(managementSession()),
      ),
      /invalid operator token lifetime/i,
    );
  }
});
test('token redemption refuses revoked sessions and mismatched actor before IAM', async () => {
  const controller = new EdgeOperatorPairingRedemptionController(
    { findActiveSessionById: async () => undefined } as unknown as FuntinoStorePort,
    {
      getActiveBranch: async () => assert.fail('branch must not be read after session revocation'),
    } as unknown as OrganizationBranchClient,
    {
      issueEdgeOperatorToken: async () => assert.fail('IAM must not issue for a revoked session'),
    } as unknown as IdentityAccessClient,
  );
  await assert.rejects(
    controller.redeem(
      {
        pairingId,
        actorUserId: userId,
        managementSessionId: sessionId,
        organizationId,
        branchId,
        permissionKeys: [...permissionKeys],
      },
      request(managementSession()),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'UNAUTHENTICATED',
  );
});
