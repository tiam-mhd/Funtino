import assert from 'node:assert/strict';
import test from 'node:test';
import { areManagementWritesEnabled } from '../src/application/management-write-gate.js';
import { isBootstrapCliEnabled } from '../src/bootstrap/bootstrap-cli-policy.js';
import { BOOTSTRAP_CLI_ENABLED_ENV } from '../src/bootstrap/bootstrap-cli-policy.js';

test('production management write gate requires an exact explicit opt-in', () => {
  assert.equal(areManagementWritesEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(
    areManagementWritesEnabled({
      NODE_ENV: 'production',
      IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED: 'TRUE',
    }),
    false,
  );
  assert.equal(
    areManagementWritesEnabled({
      NODE_ENV: 'production',
      IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED: '1',
    }),
    false,
  );
  assert.equal(
    areManagementWritesEnabled({
      NODE_ENV: 'production',
      IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED: 'true',
    }),
    true,
  );
});

test('an unknown or missing runtime environment fails closed unless explicitly opened', () => {
  assert.equal(areManagementWritesEnabled({}), false);
  assert.equal(
    areManagementWritesEnabled({ IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED: 'true' }),
    true,
  );
});

test('nonproduction remains available regardless of the production-only gate', () => {
  assert.equal(areManagementWritesEnabled({ NODE_ENV: 'test' }), true);
  assert.equal(
    areManagementWritesEnabled({
      NODE_ENV: 'development',
      IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED: 'false',
    }),
    true,
  );
  assert.equal(areManagementWritesEnabled({ NODE_ENV: 'staging' }), false);
  assert.equal(
    areManagementWritesEnabled({
      NODE_ENV: 'staging',
      IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED: 'true',
    }),
    true,
  );
});

test('bootstrap CLI requires its own exact one-off opt-in', () => {
  assert.equal(isBootstrapCliEnabled({}), false);
  assert.equal(isBootstrapCliEnabled({ [BOOTSTRAP_CLI_ENABLED_ENV]: '1' }), false);
  assert.equal(isBootstrapCliEnabled({ [BOOTSTRAP_CLI_ENABLED_ENV]: 'true' }), true);
});
