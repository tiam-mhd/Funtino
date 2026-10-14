import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { Session } from '../domain/models.js';
import { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const correlationId = '22222222-2222-4222-8222-222222222222';
const serviceToken = 'local-identity-access-token-value-with-32-plus-characters';

class TestIdentityAccessClient extends IdentityAccessClient {
  constructor(private readonly responder: (url: URL, init: RequestInit) => Promise<Response>) {
    super();
  }

  protected override fetcher(url: URL, init: RequestInit): Promise<Response> {
    return this.responder(url, init);
  }
}

function useLocalServiceConfig(): () => void {
  const previousUrl = process.env.IDENTITY_ACCESS_URL;
  const previousToken = process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
  process.env.IDENTITY_ACCESS_URL = 'http://identity-access.internal:4040';
  process.env.IDENTITY_ACCESS_SERVICE_TOKEN = serviceToken;
  return () => {
    if (previousUrl === undefined) delete process.env.IDENTITY_ACCESS_URL;
    else process.env.IDENTITY_ACCESS_URL = previousUrl;
    if (previousToken === undefined) delete process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
    else process.env.IDENTITY_ACCESS_SERVICE_TOKEN = previousToken;
  };
}

test('Gateway client sends only server-derived actor context and maps access membership responses', async () => {
  const restore = useLocalServiceConfig();
  try {
    const client = new TestIdentityAccessClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/staff/memberships/current');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-service-token'), serviceToken);
      assert.equal(headers.get('x-funtino-actor-user-id'), userId);
      assert.equal(headers.get('x-correlation-id'), correlationId);
      return new Response(JSON.stringify({ data: [], policyVersion: 4, catalogVersion: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await client.currentAccessContext(userId, correlationId);
    assert.deepEqual(result, {
      memberships: [],
      policyVersion: 4,
      catalogVersion: 1,
      managementSessionTtlHours: 12,
    });
  } finally {
    restore();
  }
});

test('Gateway client fails closed when internal service credentials are absent', async () => {
  const previousToken = process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
  delete process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
  try {
    const client = new TestIdentityAccessClient(async () => {
      throw new Error('fetch must not run without credentials');
    });
    await assert.rejects(
      client.currentAccessContext(userId, correlationId),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    if (previousToken !== undefined) process.env.IDENTITY_ACCESS_SERVICE_TOKEN = previousToken;
  }
});

test('Gateway client maps service authorization denial to a safe public 403', async () => {
  const restore = useLocalServiceConfig();
  try {
    const client = new TestIdentityAccessClient(async () => new Response('', { status: 403 }));
    await assert.rejects(
      client.listRoles(userId, '33333333-3333-4333-8333-333333333333', undefined, correlationId),
      (error: unknown) => error instanceof DomainError && error.status === 403,
    );
  } finally {
    restore();
  }
});

test('Gateway role client forwards bounded pagination and validates the response cursor', async () => {
  const restore = useLocalServiceConfig();
  try {
    const client = new TestIdentityAccessClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/roles');
      assert.equal(url.searchParams.get('organizationId'), '33333333-3333-4333-8333-333333333333');
      assert.equal(url.searchParams.get('pageSize'), '10');
      assert.equal(url.searchParams.get('cursor'), '44444444-4444-4444-8444-444444444444');
      assert.equal(new Headers(init.headers).get('x-funtino-actor-user-id'), userId);
      return new Response(
        JSON.stringify({
          status: 'success',
          data: [],
          nextCursor: '55555555-5555-4555-8555-555555555555',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await client.listRoles(
      userId,
      '33333333-3333-4333-8333-333333333333',
      undefined,
      correlationId,
      { cursor: '44444444-4444-4444-8444-444444444444', pageSize: 10 },
    );
    assert.deepEqual(result, {
      data: [],
      nextCursor: '55555555-5555-4555-8555-555555555555',
    });
  } finally {
    restore();
  }
});

test('production Gateway refuses to send its internal credential over cleartext HTTP', async () => {
  const restore = useLocalServiceConfig();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const client = new TestIdentityAccessClient(async () => {
      throw new Error('fetch must not run over cleartext in production');
    });
    await assert.rejects(
      client.currentAccessContext(userId, correlationId),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('MFA verification forwards only the server-derived actor and session to Identity Access', async () => {
  const restore = useLocalServiceConfig();
  const sessionId = '66666666-6666-4666-8666-666666666666';
  try {
    const client = new TestIdentityAccessClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/mfa/step-up/verify');
      assert.equal(init.method, 'POST');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-actor-user-id'), userId);
      assert.equal(headers.get('x-funtino-session-id'), sessionId);
      assert.equal(headers.get('x-correlation-id'), correlationId);
      assert.equal(headers.get('cache-control'), 'no-store');
      assert.deepEqual(JSON.parse(String(init.body)), { method: 'totp', code: '123456' });
      return new Response(
        JSON.stringify({
          method: 'totp',
          factorVersion: 3,
          verifiedAt: '2026-09-30T10:00:00.000Z',
          validUntil: '2026-09-30T10:05:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const proof = await client.verifyMfaStepUp(userId, sessionId, correlationId, {
      method: 'totp',
      code: '123456',
    });
    assert.equal(proof.factorVersion, 3);
  } finally {
    restore();
  }
});

test('authorization evaluation attaches only MFA evidence read from the persisted Gateway session', async () => {
  const restore = useLocalServiceConfig();
  const session: Session = {
    id: '66666666-6666-4666-8666-666666666666',
    userId,
    tokenHash: 'not-forwarded',
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    mfaVerifiedAt: Date.parse('2026-09-30T10:00:00.000Z'),
    mfaFactorVersion: 3,
    mfaMethod: 'recovery',
    audience: 'management',
    lastActivityAt: Date.now(),
  };
  try {
    const client = new TestIdentityAccessClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/authorization/evaluate');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-session-id'), session.id);
      const body = JSON.parse(String(init.body)) as { mfa?: Record<string, unknown> };
      assert.deepEqual(body.mfa, {
        verifiedAt: '2026-09-30T10:00:00.000Z',
        factorVersion: 3,
        method: 'recovery',
      });
      assert.equal(JSON.stringify(body).includes(session.tokenHash), false);
      return new Response(
        JSON.stringify({
          allowed: true,
          reason: 'role_permission',
          policyVersion: 4,
          catalogVersion: 1,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const result = await client.evaluateAuthorization(
      userId,
      session,
      { permission: 'card.assign', scope: { type: 'global' } },
      correlationId,
    );
    assert.equal(result.allowed, true);
    assert.equal(result.reason, 'role_permission');
  } finally {
    restore();
  }
});

test('sensitive audit reads forward fresh MFA evidence only from the persisted Gateway session', async () => {
  const restore = useLocalServiceConfig();
  const session: Session = {
    id: '66666666-6666-4666-8666-666666666666',
    userId,
    tokenHash: 'never-forward-this-token-hash',
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    mfaVerifiedAt: Date.parse('2026-09-30T10:00:00.000Z'),
    mfaFactorVersion: 3,
    mfaMethod: 'totp',
    audience: 'management',
    lastActivityAt: Date.now(),
  };
  try {
    const client = new TestIdentityAccessClient(async (url, init) => {
      assert.equal(url.pathname, '/internal/v1/audit');
      assert.equal(url.searchParams.get('scopeType'), 'global');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-actor-user-id'), userId);
      assert.equal(headers.get('x-funtino-session-id'), session.id);
      assert.equal(headers.get('x-funtino-mfa-verified-at'), '2026-09-30T10:00:00.000Z');
      assert.equal(headers.get('x-funtino-mfa-factor-version'), '3');
      assert.equal(headers.get('x-funtino-mfa-method'), 'totp');
      assert.equal(JSON.stringify(init.headers).includes(session.tokenHash), false);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: '77777777-7777-4777-8777-777777777777',
              actorType: 'user',
              actorUserId: userId,
              actorLabel: null,
              action: 'role.created',
              targetType: 'role',
              targetId: '88888888-8888-4888-8888-888888888888',
              scope: { type: 'global' },
              reason: null,
              beforeState: null,
              afterState: null,
              policyVersion: 4,
              correlationId,
              outcome: 'succeeded',
              createdAt: '2026-09-30T10:00:00.000Z',
            },
          ],
          nextCursor: null,
          policyVersion: 4,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    const result = await client.listAudit(userId, session, { type: 'global' }, correlationId, {
      pageSize: 10,
    });
    assert.equal(result.data[0]?.reason, null);
    assert.equal(result.data[0]?.actorUserId, userId);
    assert.equal(result.policyVersion, 4);
  } finally {
    restore();
  }
});
