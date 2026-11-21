import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { WalletServiceTokenGuard } from '../../src/interfaces/http/service-token.guard.js';

const previousToken = process.env.WALLET_GATEWAY_TOKEN;
const previousDeviceToken = process.env.DEVICE_INTEGRATION_WALLET_TOKEN;

function context(headers: Record<string, string>, method = 'GET', routeUrl = '/internal/v1/test') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, method, routeOptions: { url: routeUrl } }),
    }),
  } as never;
}

function restore() {
  if (previousToken === undefined) delete process.env.WALLET_GATEWAY_TOKEN;
  else process.env.WALLET_GATEWAY_TOKEN = previousToken;
  if (previousDeviceToken === undefined) delete process.env.DEVICE_INTEGRATION_WALLET_TOKEN;
  else process.env.DEVICE_INTEGRATION_WALLET_TOKEN = previousDeviceToken;
}

test('Wallet internal API accepts only the configured API Gateway identity and token', () => {
  try {
    const token = 'runtime-only-wallet-gateway-token-0123456789';
    process.env.WALLET_GATEWAY_TOKEN = token;
    const guard = new WalletServiceTokenGuard();
    assert.equal(
      guard.canActivate(
        context({ 'x-funtino-service-id': 'api-gateway', 'x-funtino-service-token': token }),
      ),
      true,
    );
    assert.throws(
      () =>
        guard.canActivate(
          context({ 'x-funtino-service-id': 'operations-web', 'x-funtino-service-token': token }),
        ),
      UnauthorizedException,
    );
    assert.throws(
      () =>
        guard.canActivate(
          context({
            'x-funtino-service-id': 'api-gateway',
            'x-funtino-service-token': `${token}x`,
          }),
        ),
      UnauthorizedException,
    );
  } finally {
    restore();
  }
});

test('Wallet accepts Device Integration only on its explicitly delegated Edge routes', () => {
  try {
    const token = 'runtime-only-wallet-device-integration-token-0123456789';
    process.env.DEVICE_INTEGRATION_WALLET_TOKEN = token;
    const guard = new WalletServiceTokenGuard();
    assert.equal(
      guard.canActivate(
        context(
          { 'x-funtino-service-id': 'device-integration', 'x-funtino-service-token': token },
          'GET',
          '/internal/v1/organizations/:organizationId/branches/:branchId/edge-card-mappings',
        ),
      ),
      true,
    );
    assert.throws(
      () =>
        guard.canActivate(
          context(
            { 'x-funtino-service-id': 'device-integration', 'x-funtino-service-token': token },
            'POST',
            '/internal/v1/cards',
          ),
        ),
      UnauthorizedException,
    );
  } finally {
    restore();
  }
});

test('Wallet internal API fails closed when its runtime credential is missing or weak', () => {
  try {
    delete process.env.WALLET_GATEWAY_TOKEN;
    const guard = new WalletServiceTokenGuard();
    assert.throws(
      () =>
        guard.canActivate(
          context({
            'x-funtino-service-id': 'api-gateway',
            'x-funtino-service-token': 'runtime-only-wallet-gateway-token-0123456789',
          }),
        ),
      ServiceUnavailableException,
    );
    process.env.WALLET_GATEWAY_TOKEN = 'short';
    assert.throws(
      () =>
        guard.canActivate(
          context({
            'x-funtino-service-id': 'api-gateway',
            'x-funtino-service-token': 'runtime-only-wallet-gateway-token-0123456789',
          }),
        ),
      ServiceUnavailableException,
    );
  } finally {
    restore();
  }
});
