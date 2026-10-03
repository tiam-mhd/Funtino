import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../../src/interfaces/http/health.controller.js';

const previousGatewayToken = process.env.WALLET_GATEWAY_TOKEN;
const previousBranchToken = process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
const previousRabbitUrl = process.env.RABBITMQ_URL;
const gatewayToken = 'runtime-only-wallet-gateway-token-0123456789';
const branchToken = 'runtime-only-wallet-owner-token-0123456789';

function restore() {
  if (previousGatewayToken === undefined) delete process.env.WALLET_GATEWAY_TOKEN;
  else process.env.WALLET_GATEWAY_TOKEN = previousGatewayToken;
  if (previousBranchToken === undefined) delete process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
  else process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = previousBranchToken;
  if (previousRabbitUrl === undefined) delete process.env.RABBITMQ_URL;
  else process.env.RABBITMQ_URL = previousRabbitUrl;
}

test('readiness reports database and outbox state without exposing credentials', async () => {
  try {
    process.env.WALLET_GATEWAY_TOKEN = gatewayToken;
    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = branchToken;
    delete process.env.RABBITMQ_URL;
    const controller = new HealthController({
      $queryRaw: async () => 1,
      outboxEvent: { count: async () => 0 },
    } as never);
    const readiness = await controller.ready();
    assert.deepEqual(readiness, {
      status: 'ready',
      service: 'wallet',
      outbox: { pending: 0, deadLettered: 0, publisherConfigured: false },
    });
    assert.equal(JSON.stringify(readiness).includes(gatewayToken), false);
  } finally {
    restore();
  }
});

test('readiness fails closed when caller credentials are missing, reused, or the database is down', async () => {
  try {
    process.env.WALLET_GATEWAY_TOKEN = gatewayToken;
    delete process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
    const controller = new HealthController({ $queryRaw: async () => 1 } as never);
    await assert.rejects(() => controller.ready(), ServiceUnavailableException);

    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = gatewayToken;
    await assert.rejects(() => controller.ready(), ServiceUnavailableException);

    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = 'x'.repeat(513);
    await assert.rejects(() => controller.ready(), ServiceUnavailableException);

    process.env.WALLET_ORGANIZATION_BRANCH_TOKEN = branchToken;
    const unavailable = new HealthController({
      $queryRaw: async () => {
        throw new Error('db');
      },
    } as never);
    await assert.rejects(() => unavailable.ready(), ServiceUnavailableException);
  } finally {
    restore();
  }
});
