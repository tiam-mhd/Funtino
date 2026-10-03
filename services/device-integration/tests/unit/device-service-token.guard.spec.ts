import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DeviceIntegrationServiceTokenGuard } from '../../src/interfaces/http/service-token.guard.js';

const previousToken = process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;

function context(headers: Record<string, string>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as never;
}

function restore() {
  if (previousToken === undefined) delete process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
  else process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = previousToken;
}

test('device management accepts only the configured API Gateway identity and token', () => {
  try {
    process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN = 'runtime-only-test-token-0123456789';
    const guard = new DeviceIntegrationServiceTokenGuard();
    assert.equal(
      guard.canActivate(
        context({
          'x-funtino-service-id': 'api-gateway',
          'x-funtino-service-token': process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN,
        }),
      ),
      true,
    );
    assert.throws(
      () =>
        guard.canActivate(
          context({
            'x-funtino-service-id': 'operations-web',
            'x-funtino-service-token': process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN!,
          }),
        ),
      UnauthorizedException,
    );
  } finally {
    restore();
  }
});

test('device management fails closed without a sufficiently long runtime token', () => {
  try {
    delete process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    assert.throws(
      () =>
        new DeviceIntegrationServiceTokenGuard().canActivate(
          context({
            'x-funtino-service-id': 'api-gateway',
            'x-funtino-service-token': 'runtime-only-test-token-0123456789',
          }),
        ),
      ServiceUnavailableException,
    );
  } finally {
    restore();
  }
});
