import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { EdgeIdentityLookupController } from '../interfaces/http/edge-identity-lookup.controller.js';

const userId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';
const serviceToken = 'test-device-integration-service-token-at-least-32';

function authorizedRequest(
  overrides: Partial<{
    method: string;
    route: string;
    serviceId: string;
    token: string;
  }> = {},
) {
  return {
    method: overrides.method ?? 'POST',
    routeOptions: { url: overrides.route ?? '/internal/v1/edge/identities/lookup' },
    headers: {
      'x-funtino-service-id': overrides.serviceId ?? 'device-integration',
      'x-funtino-service-token': overrides.token ?? serviceToken,
    },
  };
}

function runInternalGuard(request: ReturnType<typeof authorizedRequest>): boolean {
  const guardTypes = Reflect.getMetadata('__guards__', EdgeIdentityLookupController) as Array<
    new () => CanActivate
  >;
  assert.equal(guardTypes.length, 1);
  return new guardTypes[0]().canActivate({
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext) as boolean;
}

test('identity lookup requires the configured Device Integration service identity and exact route', () => {
  const previousToken = process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
  process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = serviceToken;
  try {
    assert.equal(runInternalGuard(authorizedRequest()), true);
    assert.throws(() => runInternalGuard(authorizedRequest({ method: 'GET' })));
    assert.throws(() => runInternalGuard(authorizedRequest({ route: '/internal/v1/edge/other' })));
    assert.throws(() => runInternalGuard(authorizedRequest({ serviceId: 'api-gateway' })));
    assert.throws(() => runInternalGuard(authorizedRequest({ token: `${serviceToken}-wrong` })));
  } finally {
    if (previousToken === undefined) delete process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    else process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = previousToken;
  }
});

test('identity lookup de-duplicates IDs, selects only identity fields, and returns masked phones', async () => {
  const previousToken = process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
  process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = serviceToken;
  let query: unknown;
  const controller = new EdgeIdentityLookupController({
    user: {
      findMany: async (value: unknown) => {
        query = value;
        return [
          { id: userId, phoneE164: '+989121234567' },
          { id: secondUserId, phoneE164: '+989351112233' },
        ];
      },
    },
  } as never);

  try {
    const result = await controller.lookup({ userIds: [userId, userId, secondUserId] });
    assert.deepEqual(query, {
      where: { id: { in: [userId, secondUserId] } },
      select: { id: true, phoneE164: true },
    });
    assert.deepEqual(result, {
      items: [
        { customerId: userId, maskedPhone: `+989${'\u2022'.repeat(7)}67` },
        { customerId: secondUserId, maskedPhone: `+989${'\u2022'.repeat(7)}33` },
      ],
    });
    assert.equal(JSON.stringify(result).includes('+989121234567'), false);
  } finally {
    if (previousToken === undefined) delete process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    else process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = previousToken;
  }
});

test('identity lookup rejects malformed bodies before querying Gateway identity data', async () => {
  const controller = new EdgeIdentityLookupController({
    user: { findMany: async () => assert.fail('identity storage must not be queried') },
  } as never);
  await assert.rejects(controller.lookup({ userIds: ['not-a-uuid'] }));
});
