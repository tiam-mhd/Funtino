import assert from 'node:assert/strict';
import test from 'node:test';
import { EdgeCustomerOperationsController } from '../../src/interfaces/http/edge-customer-operations.controller.js';
import type { DeviceRegistryService } from '../../src/application/device-registry.service.js';
import type { DeviceSignatureVerifier } from '../../src/application/ports/device-signature-verifier.port.js';
import type { EdgeOperatorTokenClient } from '../../src/infrastructure/identity-access/edge-operator-token.client.js';
import type { EdgeProvisionalCustomerClient } from '../../src/infrastructure/customer-household/edge-provisional-customer.client.js';

const installationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceInstanceId = installationId;
const branchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const organizationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const provisionalId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorUserId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const idempotencyKey = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const cardId = '99999999-9999-4999-8999-999999999999';
const householdId = '88888888-8888-4888-8888-888888888888';

function makeController() {
  const calls: {
    permission?: string;
    branchId?: string;
    provisional?: Record<string, unknown>;
    assignment?: Record<string, unknown>;
    block?: Record<string, unknown>;
    replacement?: Record<string, unknown>;
  } = {};
  const registry = {
    getEdgeInstallation: async () => ({
      sourceInstanceId,
      organizationId,
      branchId,
      currentKeyId: 'key-current',
      previousKeyId: null,
      status: 'active' as const,
      version: 1,
      lastHeartbeatAt: null,
    }),
    consumeEdgeRequestQuota: async () => true,
  } as unknown as DeviceRegistryService;
  const signatureVerifier = {
    isEdgeConfigured: () => true,
    verifyEdge: (_rawBody: Buffer, keyId: string, signature: string) =>
      keyId === 'key-current' && signature === `sha256=${'a'.repeat(64)}`,
  } as DeviceSignatureVerifier;
  const operatorTokens = {
    validate: async (_token: string, branch: string, permission: string) => {
      calls.branchId = branch;
      calls.permission = permission;
      return { actorUserId };
    },
  } as unknown as EdgeOperatorTokenClient;
  const provisionalCustomers = {
    create: async (input: Record<string, unknown>) => {
      calls.provisional = input;
      return {
        provisionalId,
        sourceInstanceId,
        branchId,
        status: 'pending_review',
        createdAt: '2026-11-21T00:00:00.000Z',
      };
    },
  } as unknown as EdgeProvisionalCustomerClient;
  const householdOperations = {
    search: async () => ({ items: [], nextCursor: null }),
    readCustomer: async () => ({}),
    readHousehold: async () => ({}),
    updateCustomer: async () => ({}),
    updateHousehold: async () => ({}),
    addMember: async () => ({}),
  } as never;
  const walletMappings = {
    listMappings: async () => [{ cardId, householdId }],
  } as never;
  const cardOperations = {
    assign: async (input: Record<string, unknown>) => {
      calls.assignment = input;
      return {
        id: '77777777-7777-4777-8777-777777777777',
        cardId,
        householdId,
        memberId: null,
        maskedIdentifier: '•••• 1234',
        status: 'assigned',
        verificationStatus: 'verified',
      };
    },
    block: async (input: Record<string, unknown>) => {
      calls.block = input;
      return {
        id: cardId,
        status: 'blocked',
        version: 2,
        maskedIdentifier: '•••• 1234',
      };
    },
    requestReplacement: async (input: Record<string, unknown>) => {
      calls.replacement = input;
      return { id: '66666666-6666-4666-8666-666666666666', cardId, status: 'requested' as const };
    },
  } as never;
  const identityLookup = { lookup: async () => new Map() } as never;
  return {
    controller: new EdgeCustomerOperationsController(
      registry,
      signatureVerifier,
      operatorTokens,
      provisionalCustomers,
      householdOperations,
      walletMappings,
      cardOperations,
      identityLookup,
    ),
    calls,
  };
}

function edgeRequest(method: string, value: unknown) {
  return { id: 'request-id', method, rawBody: Buffer.from(JSON.stringify(value)) } as never;
}

function edgeHeaders() {
  return {
    installationId,
    keyId: 'key-current',
    signature: `sha256=${'a'.repeat(64)}`,
    authorization: 'Bearer opaque-edge-token-12345678901234567890',
    idempotencyKey,
    correlationId: undefined,
  };
}

test('temporary Edge customer binds the server installation branch and IAM actor', async () => {
  const { controller, calls } = makeController();
  const rawBody = Buffer.from(JSON.stringify({ provisionalId }));
  const result = await controller.createTemporaryCustomer(
    { provisionalId },
    installationId,
    'key-current',
    `sha256=${'a'.repeat(64)}`,
    'Bearer opaque-edge-token-12345678901234567890',
    idempotencyKey,
    undefined,
    { id: 'request-id', rawBody } as never,
  );
  assert.equal(calls.branchId, branchId);
  assert.equal(calls.permission, 'customer.provisional.create');
  assert.equal(calls.provisional?.actorUserId, actorUserId);
  assert.equal(calls.provisional?.branchId, branchId);
  assert.equal(calls.provisional?.sourceInstanceId, sourceInstanceId);
  assert.equal(result.customerConfirmed, false);
  assert.equal(result.status, 'pending_review');
});

test('Edge card assignment derives branch scope from installation and enforces an expected version', async () => {
  const { controller, calls } = makeController();
  const body = {
    cardId,
    householdId,
    memberId: null,
    expectedVersion: 4,
    reason: 'Verified card issued',
  };
  const result = await controller.assignCard(
    body,
    edgeHeaders().installationId,
    edgeHeaders().keyId,
    edgeHeaders().signature,
    edgeHeaders().authorization,
    edgeHeaders().idempotencyKey,
    edgeHeaders().correlationId,
    edgeRequest('POST', body),
  );
  assert.equal(calls.permission, 'card.assign');
  assert.equal(calls.branchId, branchId);
  assert.equal(calls.assignment?.expectedVersion, 4);
  assert.equal(calls.assignment?.actorUserId, actorUserId);
  assert.equal(result.status, 'assigned');
});

test('Edge block uses the installed branch and returns no physical UID', async () => {
  const { controller, calls } = makeController();
  const body = { expectedVersion: 7, reason: 'Reported lost by operator' };
  const result = await controller.blockCard(
    cardId,
    body,
    edgeHeaders().installationId,
    edgeHeaders().keyId,
    edgeHeaders().signature,
    edgeHeaders().authorization,
    edgeHeaders().idempotencyKey,
    edgeHeaders().correlationId,
    edgeRequest('POST', body),
  );
  assert.equal(calls.permission, 'card.inventory.manage');
  assert.equal(calls.block?.branchId, branchId);
  assert.equal(calls.block?.expectedVersion, 7);
  assert.equal(result.recordVersion, 2);
  assert.equal('externalCardId' in result, false);
});

test('Edge replacement request uses the Wallet owner mapping rather than caller-supplied household identity', async () => {
  const { controller, calls } = makeController();
  const body = { expectedVersion: 9, reason: 'Card chip stopped responding' };
  const result = await controller.requestCardReplacement(
    cardId,
    body,
    edgeHeaders().installationId,
    edgeHeaders().keyId,
    edgeHeaders().signature,
    edgeHeaders().authorization,
    edgeHeaders().idempotencyKey,
    edgeHeaders().correlationId,
    edgeRequest('POST', body),
  );
  assert.equal(calls.permission, 'card.inventory.manage');
  assert.equal(calls.replacement?.householdId, householdId);
  assert.equal(calls.replacement?.expectedVersion, 9);
  assert.equal(result.status, 'requested');
});

test('temporary Edge customer rejects an installation key that does not match registry state', async () => {
  const { controller } = makeController();
  await assert.rejects(() =>
    controller.createTemporaryCustomer(
      { provisionalId },
      installationId,
      'wrong-key',
      `sha256=${'a'.repeat(64)}`,
      'Bearer opaque-edge-token-12345678901234567890',
      idempotencyKey,
      undefined,
      { id: 'request-id', rawBody: Buffer.from(JSON.stringify({ provisionalId })) } as never,
    ),
  );
});
