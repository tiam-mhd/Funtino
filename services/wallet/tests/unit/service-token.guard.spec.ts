import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { WalletServiceTokenGuard } from '../../src/interfaces/http/service-token.guard.js';

const previousToken = process.env.WALLET_GATEWAY_TOKEN;

function context(headers: Record<string, string>) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as never;
}

function restore() {
  if (previousToken === undefined) delete process.env.WALLET_GATEWAY_TOKEN;
  else process.env.WALLET_GATEWAY_TOKEN = previousToken;
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
