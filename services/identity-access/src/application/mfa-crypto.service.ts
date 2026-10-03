import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const AES_AAD = Buffer.from('funtino.identity-access.mfa.totp:v1', 'utf8');
const STEP_SECONDS = 30;

export type EncryptedTotpSecret = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
};

type Keyring = { activeVersion: string; keys: Map<string, Buffer> };

@Injectable()
export class MfaCryptoService {
  isConfigured(): boolean {
    try {
      this.keyring();
      return true;
    } catch {
      return false;
    }
  }

  createTotpSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  createOtpAuthUri(secret: string): string {
    const label = encodeURIComponent('Funtino:Administrative account');
    const issuer = encodeURIComponent('Funtino');
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
  }

  encryptSecret(secret: string): EncryptedTotpSecret {
    const keyring = this.keyring();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyring.keys.get(keyring.activeVersion)!, nonce);
    cipher.setAAD(AES_AAD);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      ciphertext,
      nonce,
      authTag: cipher.getAuthTag(),
      keyVersion: keyring.activeVersion,
    };
  }

  decryptSecret(input: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    authTag: Uint8Array;
    keyVersion: string;
  }): string {
    const keyring = this.keyring();
    const key = keyring.keys.get(input.keyVersion);
    if (!key || input.nonce.byteLength !== 12 || input.authTag.byteLength !== 16) {
      throw new ServiceUnavailableException('MFA encryption key version is unavailable.');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.nonce));
      decipher.setAAD(AES_AAD);
      decipher.setAuthTag(Buffer.from(input.authTag));
      return Buffer.concat([
        decipher.update(Buffer.from(input.ciphertext)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Stored MFA credential cannot be decrypted.');
    }
  }

  matchingTotpStep(
    secret: string,
    code: string,
    now: Date,
    lastAcceptedStep?: bigint | null,
  ): number | null {
    if (!/^\d{6}$/.test(code) || !Number.isFinite(now.getTime())) return null;
    const currentStep = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
    for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
      if (
        step < 0 ||
        (lastAcceptedStep !== null &&
          lastAcceptedStep !== undefined &&
          BigInt(step) <= lastAcceptedStep)
      ) {
        continue;
      }
      const expected = totpAtStep(secret, step);
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
    }
    return null;
  }

  createRecoveryCodes(): string[] {
    return Array.from({ length: 10 }, () => {
      const raw = randomBytes(16).toString('hex').toUpperCase();
      return raw.match(/.{1,8}/g)!.join('-');
    });
  }

  hashRecoveryCode(code: string): string | null {
    const normalized = code.replaceAll('-', '').toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(normalized)) return null;
    return createHash('sha256').update(normalized, 'ascii').digest('hex');
  }

  private keyring(): Keyring {
    const activeVersion = process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
    const rawKeyring = process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
    if (
      !activeVersion ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(activeVersion) ||
      !rawKeyring ||
      rawKeyring.length > 16_384
    ) {
      throw new ServiceUnavailableException('MFA encryption is not configured.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeyring);
    } catch {
      throw new ServiceUnavailableException('MFA encryption keyring is invalid.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ServiceUnavailableException('MFA encryption keyring is invalid.');
    }

    const keys = new Map<string, Buffer>();
    for (const [version, encoded] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(version) || typeof encoded !== 'string') {
        throw new ServiceUnavailableException('MFA encryption keyring is invalid.');
      }
      const key = Buffer.from(encoded, 'base64');
      if (key.byteLength !== 32 || key.toString('base64') !== encoded) {
        throw new ServiceUnavailableException('MFA encryption keyring is invalid.');
      }
      keys.set(version, key);
    }
    if (!keys.has(activeVersion)) {
      throw new ServiceUnavailableException('Active MFA encryption key is unavailable.');
    }
    return { activeVersion, keys };
  }
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replaceAll('=', '')) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new ServiceUnavailableException('Stored MFA credential is invalid.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpAtStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function createTotpForTest(secret: string, time: Date): string {
  return totpAtStep(secret, Math.floor(time.getTime() / 1000 / STEP_SECONDS));
}
