import assert from 'node:assert/strict';
import test from 'node:test';
import { isServiceTokenValid } from '../src/interfaces/http/service-token.guard.js';

test('internal credential comparison fails closed for missing, short, malformed, and mismatched tokens', () => {
  const secret = 'a-development-token-with-at-least-thirty-two-characters';
  assert.equal(isServiceTokenValid(undefined, secret), false);
  assert.equal(isServiceTokenValid('too-short', secret), false);
  assert.equal(isServiceTokenValid(secret, undefined), false);
  assert.equal(isServiceTokenValid(secret, `${secret}-wrong`), false);
});

test('internal credential comparison accepts the configured service token', () => {
  const secret = 'a-development-token-with-at-least-thirty-two-characters';
  assert.equal(isServiceTokenValid(secret, secret), true);
});
