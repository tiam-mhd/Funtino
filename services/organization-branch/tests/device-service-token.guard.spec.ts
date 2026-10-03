import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OrganizationBranchServiceTokenGuard } from '../src/interfaces/http/service-token.guard.js';

const previousToken = process.env.ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN;
const previousIdentityToken = process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
const previousWalletToken = process.env.ORGANIZATION_BRANCH_WALLET_TOKEN;

function executionContext(
  headers: Record<string, string>,
  route = '/internal/v1/scopes/validate',
  method = 'POST',
) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, method, routeOptions: { url: route } }) }),
  } as never;
}

function restoreToken() {
  if (previousToken === undefined) delete process.env.ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN;
  else process.env.ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN = previousToken;
  if (previousIdentityToken === undefined)
    delete process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
  else process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN = previousIdentityToken;
  if (previousWalletToken === undefined) delete process.env.ORGANIZATION_BRANCH_WALLET_TOKEN;
  else process.env.ORGANIZATION_BRANCH_WALLET_TOKEN = previousWalletToken;
}

test('Organization & Branch owner accepts only a configured Device Integration service token', () => {
  try {
    const token = 'runtime-only-test-token-0123456789';
    process.env.ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN = token;
    const guard = new OrganizationBranchServiceTokenGuard();
    assert.equal(
      guard.canActivate(
        executionContext({
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
        }),
      ),
      true,
    );
    assert.throws(
      () =>
        guard.canActivate(
          executionContext(
            {
              'x-funtino-service-id': 'device-integration',
              'x-funtino-service-token': token,
            },
            '/internal/v1/organizations',
            'GET',
          ),
        ),
      UnauthorizedException,
    );
    assert.throws(
      () =>
        guard.canActivate(
          executionContext({
            'x-funtino-service-id': 'device-integration',
            'x-funtino-service-token': 'incorrect-runtime-token-0123456789',
          }),
        ),
      UnauthorizedException,
    );
  } finally {
    restoreToken();
  }
});

test('Identity Access service token is restricted to scope validation only', () => {
  try {
    const token = 'runtime-only-identity-access-token-0123456789';
    process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN = token;
    const guard = new OrganizationBranchServiceTokenGuard();
    const headers = {
      'x-funtino-service-id': 'identity-access',
      'x-funtino-service-token': token,
    };

    assert.equal(guard.canActivate(executionContext(headers)), true);
    for (const [route, method] of [
      ['/internal/v1/organizations', 'GET'],
      ['/internal/v1/organizations', 'POST'],
      ['/internal/v1/branches', 'PATCH'],
      ['/internal/v1/scopes/validate', 'GET'],
    ] as const) {
      assert.throws(
        () => guard.canActivate(executionContext(headers, route, method)),
        UnauthorizedException,
      );
    }
    assert.throws(
      () =>
        guard.canActivate(
          executionContext({
            ...headers,
            'x-funtino-service-token': 'incorrect-identity-token-0123456789',
          }),
        ),
      UnauthorizedException,
    );
  } finally {
    restoreToken();
  }
});

test('Organization & Branch owner fails closed when Identity Access credential is missing', () => {
  try {
    delete process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
    assert.throws(
      () =>
        new OrganizationBranchServiceTokenGuard().canActivate(
          executionContext({
            'x-funtino-service-id': 'identity-access',
            'x-funtino-service-token': 'runtime-only-identity-access-token-0123456789',
          }),
        ),
      ServiceUnavailableException,
    );
  } finally {
    restoreToken();
  }
});

test('Organization & Branch owner fails closed when Device Integration credential is missing', () => {
  try {
    delete process.env.ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN;
    assert.throws(
      () =>
        new OrganizationBranchServiceTokenGuard().canActivate(
          executionContext({
            'x-funtino-service-id': 'device-integration',
            'x-funtino-service-token': 'runtime-only-test-token-0123456789',
          }),
        ),
      ServiceUnavailableException,
    );
  } finally {
    restoreToken();
  }
});

test('Wallet can validate scope but cannot read or write Organization & Branch resources', () => {
  try {
    const token = 'runtime-only-wallet-owner-token-0123456789';
    process.env.ORGANIZATION_BRANCH_WALLET_TOKEN = token;
    const guard = new OrganizationBranchServiceTokenGuard();
    const headers = {
      'x-funtino-service-id': 'wallet',
      'x-funtino-service-token': token,
    };

    assert.equal(guard.canActivate(executionContext(headers)), true);
    for (const [route, method] of [
      ['/internal/v1/organizations', 'GET'],
      ['/internal/v1/branches', 'POST'],
      ['/internal/v1/scopes/validate', 'GET'],
    ] as const) {
      assert.throws(
        () => guard.canActivate(executionContext(headers, route, method)),
        UnauthorizedException,
      );
    }
  } finally {
    restoreToken();
  }
});
