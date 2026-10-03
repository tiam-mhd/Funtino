import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupFailureEvent } from '../src/bootstrap/startup-failure.js';

test('identifies the exact missing production metrics token without weakening the gate', () => {
  const event = createStartupFailureEvent(
    'analytics-read-model',
    'register_telemetry',
    new Error('ANALYTICS_METRICS_TOKEN is required in production.'),
  );

  assert.equal(event.level, 'fatal');
  assert.equal(event.event, 'service.startup_failed');
  assert.equal(event.service, 'analytics-read-model');
  assert.equal(event.stage, 'register_telemetry');
  assert.equal(event.error.code, 'METRICS_TOKEN_REQUIRED');
  assert.equal(event.error.configurationKey, 'ANALYTICS_METRICS_TOKEN');
});

test('reports Prisma environment names and cause codes without hiding the useful diagnosis', () => {
  const error = Object.assign(
    new Error('Environment variable not found: ANALYTICS_DATABASE_URL.'),
    { code: 'P1012' },
  );
  const event = createStartupFailureEvent('analytics-read-model', 'create_application', error);

  assert.equal(event.error.code, 'ENVIRONMENT_VARIABLE_MISSING');
  assert.equal(event.error.configurationKey, 'ANALYTICS_DATABASE_URL');
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
    const event = createStartupFailureEvent('analytics-read-model', 'listen', error);
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
