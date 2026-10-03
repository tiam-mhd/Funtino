import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeviceStatusTransition,
  deriveHealthState,
  normalizeAdapterKey,
  normalizeExternalDeviceId,
} from '../../src/domain/device/device.js';

const policy = { staleAfterSeconds: 300, offlineAfterSeconds: 900 };
const now = new Date('2026-10-01T10:00:00.000Z');

test('device health starts unknown and derives online, degraded, stale and offline from persisted time', () => {
  assert.equal(deriveHealthState(null, null, now, policy), 'unknown');
  assert.equal(
    deriveHealthState('online', new Date(now.getTime() - 10_000), now, policy),
    'online',
  );
  assert.equal(
    deriveHealthState('degraded', new Date(now.getTime() - 10_000), now, policy),
    'degraded',
  );
  assert.equal(
    deriveHealthState('online', new Date(now.getTime() - 300_000), now, policy),
    'stale',
  );
  assert.equal(
    deriveHealthState('online', new Date(now.getTime() - 900_000), now, policy),
    'offline',
  );
  assert.equal(
    deriveHealthState('offline', new Date(now.getTime() - 1_000), now, policy),
    'offline',
  );
});

test('future timestamps are clamped for freshness and do not prematurely mark a device stale', () => {
  assert.equal(
    deriveHealthState('online', new Date(now.getTime() + 50_000), now, policy),
    'online',
  );
});

test('retirement is terminal while active and suspended devices follow the supported lifecycle', () => {
  assert.doesNotThrow(() => assertDeviceStatusTransition('active', 'suspended'));
  assert.doesNotThrow(() => assertDeviceStatusTransition('suspended', 'active'));
  assert.doesNotThrow(() => assertDeviceStatusTransition('suspended', 'retired'));
  assert.throws(
    () => assertDeviceStatusTransition('retired', 'active'),
    /DEVICE_RETIRED_IS_TERMINAL/,
  );
});

test('adapter keys normalize case while physical IDs preserve case after trimming', () => {
  assert.equal(normalizeAdapterKey(' RFID.V1 '), 'rfid.v1');
  assert.equal(normalizeExternalDeviceId('  AbC-123  '), 'AbC-123');
});
