import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSafeErrorDiagnostic,
  createStartupFailureEvent,
} from '../src/bootstrap/startup-failure.js';

test('identifies the exact missing production metrics token without weakening the gate', () => {
  const event = createStartupFailureEvent(
    'organization-branch',
    'register_telemetry',
    new Error('ORGANIZATION_BRANCH_METRICS_TOKEN is required in production.'),
  );

  assert.equal(event.level, 'fatal');
  assert.equal(event.event, 'service.startup_failed');
  assert.equal(event.service, 'organization-branch');
  assert.equal(event.stage, 'register_telemetry');
  assert.equal(event.error.code, 'METRICS_TOKEN_REQUIRED');
  assert.equal(event.error.configurationKey, 'ORGANIZATION_BRANCH_METRICS_TOKEN');
});

test('reports Prisma environment names and cause codes without hiding the useful diagnosis', () => {
  const error = Object.assign(
    new Error('Environment variable not found: ORGANIZATION_BRANCH_DATABASE_URL.'),
    { code: 'P1012' },
  );
  const event = createStartupFailureEvent('organization-branch', 'create_application', error);

  assert.equal(event.error.code, 'ENVIRONMENT_VARIABLE_MISSING');
  assert.equal(event.error.configurationKey, 'ORGANIZATION_BRANCH_DATABASE_URL');
  assert.equal(event.error.causeCode, 'P1012');
});

test('redacts connection URLs and configured secret values from startup messages', () => {
  const envKey = 'STARTUP_FAILURE_TEST_SECRET';
  const previousValue = process.env[envKey];
  const secretValue = 'test-secret-value-that-must-not-be-logged';
  process.env[envKey] = secretValue;

  try {
    const error = Object.assign(
      new Error(`connect to postgresql://runtime:${secretValue}@private-db:5432/app failed`),
      { code: 'P1001' },
    );
    const event = createStartupFailureEvent('organization-branch', 'listen', error);
    const serialized = JSON.stringify(event);

    assert.equal(event.error.causeCode, 'P1001');
    assert.doesNotMatch(serialized, /test-secret-value-that-must-not-be-logged/);
    assert.doesNotMatch(serialized, /postgresql:\/\//);
    assert.match(serialized, /URL_REDACTED/);
  } finally {
    if (previousValue === undefined) delete process.env[envKey];
    else process.env[envKey] = previousValue;
  }
});

test('reports safe error codes and cause details for background failures without exposing URLs', () => {
  const cause = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
  const error = Object.assign(
    new Error('Failed to query postgresql://runtime:private-password@private-db:5432/app'),
    { code: 'P1001', cause },
  );
  const diagnostic = createSafeErrorDiagnostic(error);
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.name, 'Error');
  assert.equal(diagnostic.code, 'P1001');
  assert.equal(diagnostic.causeName, 'Error');
  assert.equal(diagnostic.causeCode, 'ECONNRESET');
  assert.doesNotMatch(serialized, /private-password|private-db|postgresql:\/\//);
});

test('reports only the PostgreSQL SQLSTATE for raw Prisma failures', () => {
  const error = Object.assign(new Error('Raw query failed'), {
    code: 'P2010',
    meta: {
      code: '42P01',
      message:
        'relation missing; query contains postgresql://user:secret@db/private and private data',
    },
  });
  const diagnostic = createSafeErrorDiagnostic(error);
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.code, 'P2010');
  assert.equal(diagnostic.databaseCode, '42P01');
  assert.doesNotMatch(serialized, /postgresql:\/\/|secret|private data|relation missing/);
});
