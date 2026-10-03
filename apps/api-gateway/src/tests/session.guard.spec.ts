import assert from 'node:assert/strict';
import test from 'node:test';
import { hashSecret } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import { SessionGuard } from '../interfaces/http/session.guard.js';

const now = Date.now();
const adminSession: Session = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  tokenHash: hashSecret('session-token'),
  expiresAt: now + 60_000,
  revokedAt: null,
  mfaVerifiedAt: null,
  mfaFactorVersion: null,
  mfaMethod: null,
  isSystemAdmin: true,
  mfaLoginDeadlineAt: now + 5 * 60_000,
  lastActivityAt: now,
};

function context(method: string, url: string) {
  const request = { method, url, cookies: { funtino_session: 'session-token' } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function guardFor(session: Session | undefined, calls: string[] = []) {
  const store = {
    findSession: async (hash: string) => (hash === adminSession.tokenHash ? session : undefined),
    touchSessionActivity: async (id: string) => {
      calls.push(`touch:${id}`);
    },
    revokeSession: async (hash: string) => {
      calls.push(`revoke:${hash}`);
    },
  };
  return new SessionGuard(store as never);
}

test('MFA-pending system-admin session can reach only login-MFA routes', async () => {
  const calls: string[] = [];
  const guard = guardFor(adminSession, calls);
  await assert.rejects(guard.canActivate(context('GET', '/api/v1/auth/me')));
  assert.equal(calls.length, 0);

  assert.equal(await guard.canActivate(context('GET', '/api/v1/operations/mfa/status')), true);
  assert.equal(calls[0], `touch:${adminSession.id}`);
});

test('expired MFA enrollment window revokes the pending admin session', async () => {
  const calls: string[] = [];
  const expired = { ...adminSession, mfaLoginDeadlineAt: now - 1 };
  await assert.rejects(
    guardFor(expired, calls).canActivate(context('GET', '/api/v1/operations/mfa/status')),
  );
  assert.deepEqual(calls, [`revoke:${adminSession.tokenHash}`]);
});

test('admin idle timeout revokes even a session with MFA evidence', async () => {
  const calls: string[] = [];
  const idle = {
    ...adminSession,
    mfaVerifiedAt: now - 16 * 60_000,
    lastActivityAt: now - 16 * 60_000,
  };
  await assert.rejects(guardFor(idle, calls).canActivate(context('GET', '/api/v1/auth/me')));
  assert.deepEqual(calls, [`revoke:${adminSession.tokenHash}`]);
});
