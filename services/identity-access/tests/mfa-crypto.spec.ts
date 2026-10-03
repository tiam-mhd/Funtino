import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { createTotpForTest, MfaCryptoService } from '../src/application/mfa-crypto.service.js';

function setTestKeyring(): () => void {
  const previousKeys = process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
  const previousVersion = process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
  process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS = JSON.stringify({
    v1: Buffer.alloc(32, 7).toString('base64'),
  });
  process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION = 'v1';
  return () => {
    if (previousKeys === undefined) delete process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
    else process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS = previousKeys;
    if (previousVersion === undefined) delete process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
    else process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION = previousVersion;
  };
}

test('TOTP matches RFC 6238 SHA-1 vector and rejects reused time steps', () => {
  const service = new MfaCryptoService();
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const time = new Date(59_000);
  const code = createTotpForTest(secret, time);
  assert.equal(code, '287082');
  assert.equal(service.matchingTotpStep(secret, code, time), 1);
  assert.equal(service.matchingTotpStep(secret, code, time, 1n), null);
  assert.equal(service.matchingTotpStep(secret, '00000x', time), null);
});

test('TOTP accepts only the adjacent time window and validates codes in constant time', () => {
  const service = new MfaCryptoService();
  const secret = service.createTotpSecret();
  const time = new Date(1_700_000_000_000);
  assert.equal(
    service.matchingTotpStep(
      secret,
      createTotpForTest(secret, new Date(time.getTime() + 30_000)),
      time,
    ),
    Math.floor(time.getTime() / 30_000) + 1,
  );
  assert.equal(service.matchingTotpStep(secret, '123456', new Date(time.getTime() + 90_000)), null);
});

test('TOTP secret is AES-GCM encrypted and key versions remain readable during rotation', () => {
  const restore = setTestKeyring();
  try {
    const service = new MfaCryptoService();
    const secret = service.createTotpSecret();
    const encrypted = service.encryptSecret(secret);
    assert.notEqual(encrypted.ciphertext.toString('utf8'), secret);
    assert.equal(service.decryptSecret({ ...encrypted, keyVersion: 'v1' }), secret);
    process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS = JSON.stringify({
      v1: Buffer.alloc(32, 7).toString('base64'),
      v2: Buffer.alloc(32, 8).toString('base64'),
    });
    process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION = 'v2';
    assert.equal(service.decryptSecret({ ...encrypted, keyVersion: 'v1' }), secret);
    assert.equal(service.encryptSecret(secret).keyVersion, 'v2');
    assert.throws(
      () => service.decryptSecret({ ...encrypted, keyVersion: 'missing' }),
      ServiceUnavailableException,
    );
  } finally {
    restore();
  }
});

test('recovery codes are ten distinct high-entropy values and only their normalized hashes are retained', () => {
  const service = new MfaCryptoService();
  const codes = service.createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/);
    assert.match(service.hashRecoveryCode(code) ?? '', /^[0-9a-f]{64}$/);
    assert.equal(
      service.hashRecoveryCode(code),
      service.hashRecoveryCode(code.replaceAll('-', '').toLowerCase()),
    );
  }
  assert.equal(service.hashRecoveryCode('not-a-recovery-code'), null);
});

test('invalid or absent MFA keyrings fail closed without exposing key material', () => {
  const previousKeys = process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
  const previousVersion = process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
  delete process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
  delete process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
  try {
    const service = new MfaCryptoService();
    assert.equal(service.isConfigured(), false);
    assert.throws(
      () => service.createTotpSecret() && service.encryptSecret('secret'),
      ServiceUnavailableException,
    );
  } finally {
    if (previousKeys !== undefined) process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS = previousKeys;
    if (previousVersion !== undefined)
      process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION = previousVersion;
  }
});
