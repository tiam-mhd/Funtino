import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import { WalletClient, type WalletCardInventory } from '../infrastructure/wallet/wallet.client.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';
const token = 'wallet-gateway-runtime-secret-0123456789';

class TestClient extends WalletClient {
  constructor(private readonly responder: (url: URL, init: RequestInit) => Promise<Response>) {
    super();
  }

  protected override fetcher(url: URL, init: RequestInit) {
    return this.responder(url, init);
  }
}

async function withWalletEnvironment<T>(run: () => Promise<T>) {
  const previous = {
    url: process.env.WALLET_URL,
    token: process.env.WALLET_GATEWAY_TOKEN,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.WALLET_URL = 'http://wallet.internal:4070';
  process.env.WALLET_GATEWAY_TOKEN = token;
  process.env.NODE_ENV = 'test';
  try {
    return await run();
  } finally {
    if (previous.url === undefined) delete process.env.WALLET_URL;
    else process.env.WALLET_URL = previous.url;
    if (previous.token === undefined) delete process.env.WALLET_GATEWAY_TOKEN;
    else process.env.WALLET_GATEWAY_TOKEN = previous.token;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
  }
}

function card(): WalletCardInventory {
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

test('lists only validated masked inventory using the internal Gateway identity', async () => {
  await withWalletEnvironment(async () => {
    const client = new TestClient(async (url, init) => {
      assert.equal(
        url.toString(),
        `http://wallet.internal:4070/internal/v1/organizations/${organizationId}/branches/${branchId}/cards?pageSize=25&status=in_stock&cursor=${cardId}`,
      );
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-service-id'), 'api-gateway');
      assert.equal(headers.get('x-funtino-service-token'), token);
      assert.equal(headers.get('cache-control'), 'no-store');
      assert.equal(init.redirect, 'error');
      assert.equal(init.signal instanceof AbortSignal, true);
      return new Response(JSON.stringify({ items: [card()], nextCursor: null }), { status: 200 });
    });

    assert.deepEqual(
      await client.listCards({
        organizationId,
        branchId,
        status: 'in_stock',
        cursor: cardId,
        pageSize: 25,
      }),
      { items: [card()], nextCursor: null },
    );
  });
});

test('register and status commands forward actor/correlation/idempotency and version without exposing raw ids', async () => {
  await withWalletEnvironment(async () => {
    let calls = 0;
    const client = new TestClient(async (_url, init) => {
      calls++;
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-funtino-actor-user-id'), actorUserId);
      assert.equal(headers.get('x-correlation-id'), correlationId);
      assert.equal(headers.get('idempotency-key'), idempotencyKey);
      assert.equal(init.redirect, 'error');
      if (init.method === 'POST') {
        assert.equal(headers.get('if-match'), null);
        assert.deepEqual(JSON.parse(String(init.body)), {
          externalCardId: 'private-physical-id-1029',
          reason: 'Initial branch stock registration',
        });
        return new Response(JSON.stringify(card()), { status: 201 });
      }
      assert.equal(init.method, 'PATCH');
      assert.equal(headers.get('if-match'), '1');
      assert.deepEqual(JSON.parse(String(init.body)), {
        status: 'blocked',
        reason: 'Card reported lost by customer',
      });
      return new Response(JSON.stringify({ ...card(), status: 'blocked', version: 2 }), {
        status: 200,
      });
    });

    const meta = { actorUserId, correlationId, idempotencyKey };
    await client.registerCard(
      organizationId,
      branchId,
      { externalCardId: 'private-physical-id-1029', reason: 'Initial branch stock registration' },
      meta,
    );
    const updated = await client.changeCardStatus(
      organizationId,
      branchId,
      cardId,
      1,
      { status: 'blocked', reason: 'Card reported lost by customer' },
      meta,
    );
    assert.equal(updated.status, 'blocked');
    assert.equal(calls, 2);
  });
});

test('fails closed on missing credentials, insecure production URL, redirects and malformed owner responses', async () => {
  const old = {
    url: process.env.WALLET_URL,
    token: process.env.WALLET_GATEWAY_TOKEN,
    nodeEnv: process.env.NODE_ENV,
  };
  let requests = 0;
  let responder: (url: URL, init: RequestInit) => Promise<Response> = async () => {
    requests++;
    return new Response('{}', { status: 200 });
  };
  const client = new TestClient((url, init) => responder(url, init));
  try {
    delete process.env.WALLET_URL;
    process.env.WALLET_GATEWAY_TOKEN = token;
    await assert.rejects(client.listCards({ organizationId, branchId, pageSize: 25 }), {
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    assert.equal(requests, 0);

    process.env.WALLET_URL = 'http://wallet.internal:4070';
    process.env.NODE_ENV = 'production';
    await assert.rejects(client.listCards({ organizationId, branchId, pageSize: 25 }), {
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    assert.equal(requests, 0);

    process.env.NODE_ENV = 'test';
    process.env.WALLET_URL = 'http://wallet.internal:4070';
    responder = async (_url, init) => {
      assert.equal(init.redirect, 'error');
      throw new TypeError('redirect blocked');
    };
    await assert.rejects(client.listCards({ organizationId, branchId, pageSize: 25 }), {
      code: 'DEPENDENCY_UNAVAILABLE',
    });

    responder = async () =>
      new Response(
        JSON.stringify({ items: [{ ...card(), externalCardId: 'raw' }], nextCursor: null }),
        { status: 200 },
      );
    await assert.rejects(
      client.listCards({ organizationId, branchId, pageSize: 25 }),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );

    responder = async () =>
      new Response(
        JSON.stringify({ items: [{ ...card(), branchId: organizationId }], nextCursor: null }),
        { status: 200 },
      );
    await assert.rejects(
      client.listCards({ organizationId, branchId, pageSize: 25 }),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    if (old.url === undefined) delete process.env.WALLET_URL;
    else process.env.WALLET_URL = old.url;
    if (old.token === undefined) delete process.env.WALLET_GATEWAY_TOKEN;
    else process.env.WALLET_GATEWAY_TOKEN = old.token;
    if (old.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old.nodeEnv;
  }
});
