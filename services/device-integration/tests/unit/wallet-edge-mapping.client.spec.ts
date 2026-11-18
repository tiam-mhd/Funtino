import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { WalletEdgeMappingClient } from '../../src/infrastructure/wallet/wallet-edge-mapping.client.js';

test('Wallet ownership and sequence conflicts remain actionable to the Edge caller', async () => {
  const oldUrl = process.env.WALLET_URL;
  const oldToken = process.env.WALLET_DEVICE_INTEGRATION_TOKEN;
  const oldNodeEnv = process.env.NODE_ENV;
  const oldFetch = globalThis.fetch;
  process.env.WALLET_URL = 'http://127.0.0.1:4100';
  process.env.WALLET_DEVICE_INTEGRATION_TOKEN = 'x'.repeat(48);
  process.env.NODE_ENV = 'test';
  globalThis.fetch = (async () => new Response('', { status: 409 })) as typeof fetch;

  try {
    const client = new WalletEdgeMappingClient();
    await assert.rejects(client.reconcileBalanceSnapshot({
      snapshotId: '11111111-1111-4111-8111-111111111111',
      sourceInstanceId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      branchId: '44444444-4444-4444-8444-444444444444',
      cardId: '55555555-5555-4555-8555-555555555555',
      householdId: '66666666-6666-4666-8666-666666666666',
      memberId: null,
      snapshotVersion: 'branch-v2',
      localSequence: 12,
      balanceRial: 10_000,
      currencyCode: 'IRR',
      observedAt: new Date().toISOString(),
    }), ConflictException);
  } finally {
    globalThis.fetch = oldFetch;
    restoreEnv('WALLET_URL', oldUrl);
    restoreEnv('WALLET_DEVICE_INTEGRATION_TOKEN', oldToken);
    restoreEnv('NODE_ENV', oldNodeEnv);
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
