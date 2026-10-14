import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import { SystemHealthController } from '../interfaces/http/system-health.controller.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type {
  PrometheusTelemetryClient,
  SystemHealthSnapshot,
} from '../infrastructure/observability/prometheus-telemetry.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const correlationId = '22222222-2222-4222-8222-222222222222';

function session(): Session {
  return {
    id: '33333333-3333-4333-8333-333333333333',
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
  return { session: session(), requestId: 'request-1', correlationId } as AuthenticatedRequest;
}

const snapshot: SystemHealthSnapshot = {
  observedAt: '2026-10-01T08:00:00.000Z',
  source: 'prometheus',
  services: [],
  activeAlerts: [],
};

function controller(allowed: boolean, readSystemHealth: () => Promise<SystemHealthSnapshot>) {
  const access = {
    evaluateAuthorization: async (
      _userId: string,
      _session: Session,
      input: { permission: string; scope: unknown },
    ) => {
      assert.equal(input.permission, 'system.health.read');
      assert.deepEqual(input.scope, { type: 'global' });
      return { allowed, policyVersion: 1, catalogVersion: 1 };
    },
  };
  return new SystemHealthController(
    access as unknown as IdentityAccessClient,
    { readSystemHealth } as unknown as PrometheusTelemetryClient,
  );
}

test('system health requires the global system.health.read permission before querying telemetry', async () => {
  let queried = false;
  const instance = controller(false, async () => {
    queried = true;
    return snapshot;
  });
  await assert.rejects(
    instance.getSystemHealth({ id: userId }, request()),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(queried, false);
});

test('authorized system health reads return a success envelope', async () => {
  const instance = controller(true, async () => snapshot);
  const result = await instance.getSystemHealth({ id: userId }, request());
  assert.deepEqual(result.data, snapshot);
  assert.equal(result.meta.requestId, 'request-1');
});
