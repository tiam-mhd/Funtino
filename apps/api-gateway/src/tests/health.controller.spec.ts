import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { HealthController } from '../interfaces/http/health.controller.js';

function callReady() {
  const request = {
    requestId: 'health-request',
    correlationId: 'health-correlation',
  } as FastifyRequest & { requestId?: string; correlationId?: string };
  return new HealthController().ready(request);
}

test('readiness fails closed when the family phone hash secret is missing or invalid', () => {
  const previousSecret = process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
  try {
    for (const secret of [undefined, 's'.repeat(31), 's'.repeat(513)]) {
      if (secret === undefined) delete process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
      else process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = secret;

      const result = callReady();
      assert.equal(result.data.status, 'degraded');
      assert.equal(result.data.customerFamilyConfigured, false);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
    else process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = previousSecret;
  }
});

test('readiness succeeds for a valid shared family phone hash secret', () => {
  const previousSecret = process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
  process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = randomBytes(32).toString('base64url');
  try {
    const result = callReady();
    assert.equal(result.data.status, 'ready');
    assert.equal(result.data.customerFamilyConfigured, true);
  } finally {
    if (previousSecret === undefined) delete process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
    else process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = previousSecret;
  }
});
