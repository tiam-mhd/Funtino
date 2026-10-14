import assert from 'node:assert/strict';
import test from 'node:test';
import { hashSecret } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import { SYSTEM_ADMIN_IDLE_TIMEOUT_MS } from '../application/auth/session-policy.js';
import { SessionGuard } from '../interfaces/http/session.guard.js';

const now = Date.now();
const managementSession: Session = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  audience: 'management',
  tokenHash: hashSecret('management-token'),
  expiresAt: now + 60_000,
  revokedAt: null,
  mfaVerifiedAt: null,
  mfaFactorVersion: null,
  mfaMethod: null,
  lastActivityAt: now,
};
const customerSession: Session = {
  ...managementSession,
  audience: 'customer',
  tokenHash: hashSecret('customer-token'),
};

function context(
  method: string,
  url: string,
  cookies: Record<string, string> = {
    funtino_session: 'customer-token',
    funtino_management_session: 'management-token',
  },
) {
  const request = {
    method,
    url,
    cookies,
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function guardFor(sessions: Session[], calls: string[] = []) {
  const store = {
    findSession: async (hash: string) => sessions.find((session) => session.tokenHash === hash),
    touchSessionActivity: async (id: string) => {
      calls.push(`touch:${id}`);
    },
    revokeSession: async (hash: string) => {
      calls.push(`revoke:${hash}`);
    },
  };
  return new SessionGuard(store as never);
}

test('management audience reaches operations and system without login MFA gating', async () => {
  const calls: string[] = [];
  const guard = guardFor([managementSession], calls);
  assert.equal(await guard.canActivate(context('GET', '/api/v1/operations/mfa/status')), true);
  assert.equal(await guard.canActivate(context('GET', '/api/v1/system/health')), true);
  assert.deepEqual(calls, [`touch:${managementSession.id}`, `touch:${managementSession.id}`]);
});

test('customer and management cookies cannot cross API audiences', async () => {
  const guard = guardFor([customerSession, managementSession]);
  assert.equal(await guard.canActivate(context('GET', '/api/v1/auth/me')), true);
  assert.equal(await guard.canActivate(context('GET', '/api/v1/customer/profile')), true);
  await assert.rejects(
    guard.canActivate(
      context('GET', '/api/v1/operations/scopes', { funtino_session: 'customer-token' }),
    ),
  );
  await assert.rejects(
    guard.canActivate(
      context('GET', '/api/v1/customer/profile', {
        funtino_management_session: 'management-token',
      }),
    ),
  );
});

test('management idle timeout revokes the expired session', async () => {
  const calls: string[] = [];
  const idle = {
    ...managementSession,
    lastActivityAt: now - SYSTEM_ADMIN_IDLE_TIMEOUT_MS - 1,
  };
  await assert.rejects(
    guardFor([idle], calls).canActivate(context('GET', '/api/v1/operations/scopes')),
  );
  assert.deepEqual(calls, [`revoke:${managementSession.tokenHash}`]);
});

test('a guarded route outside the approved audiences fails closed', async () => {
  await assert.rejects(
    guardFor([managementSession]).canActivate(context('GET', '/api/v1/auth/other')),
  );
});
