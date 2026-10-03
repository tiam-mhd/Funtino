import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';

type LookupKeyring = { activeVersion: string; keys: Map<string, Buffer> };

@Injectable()
export class AccessManagementCryptoService {
  isConfigured(): boolean {
    try {
      this.keyring();
      return true;
    } catch {
      return false;
    }
  }

  hashPhone(phoneE164: string): { keyVersion: string; hash: string } {
    const keyring = this.keyring();
    return {
      keyVersion: keyring.activeVersion,
      hash: this.digest(keyring.keys.get(keyring.activeVersion)!, `phone:v1:${phoneE164}`),
    };
  }

  phoneHashCandidates(phoneE164: string): Array<{ keyVersion: string; hash: string }> {
    const keyring = this.keyring();
    return [...keyring.keys].map(([keyVersion, key]) => ({
      keyVersion,
      hash: this.digest(key, `phone:v1:${phoneE164}`),
    }));
  }

  hashRequest(operation: string, value: unknown, keyVersion?: string): {
    keyVersion: string;
    hash: string;
  } {
    const keyring = this.keyring();
    const version = keyVersion ?? keyring.activeVersion;
    const key = keyring.keys.get(version);
    if (!key) {
      throw new ServiceUnavailableException('An idempotency hash key version is unavailable.');
    }
    const canonical = canonicalJson(value);
    return {
      keyVersion: version,
      hash: this.digest(key, `request:v1:${operation}:${canonical}`),
    };
  }

  maskPhone(phoneE164: string): string {
    const visiblePrefixLength = Math.min(3, Math.max(2, phoneE164.length - 2));
    return `${phoneE164.slice(0, visiblePrefixLength)}${'•'.repeat(
      Math.max(3, phoneE164.length - visiblePrefixLength - 2),
    )}${phoneE164.slice(-2)}`;
  }

  private digest(key: Buffer, value: string): string {
    return createHmac('sha256', key).update(value, 'utf8').digest('hex');
  }

  private keyring(): LookupKeyring {
    const activeVersion = process.env.IDENTITY_ACCESS_LOOKUP_ACTIVE_KEY_VERSION;
    const rawKeyring = process.env.IDENTITY_ACCESS_LOOKUP_HMAC_KEYS;
    if (
      !activeVersion ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(activeVersion) ||
      !rawKeyring ||
      rawKeyring.length > 16_384
    ) {
      throw new ServiceUnavailableException('Identity access lookup hashing is not configured.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeyring);
    } catch {
      throw new ServiceUnavailableException('Identity access lookup keyring is invalid.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ServiceUnavailableException('Identity access lookup keyring is invalid.');
    }

    const keys = new Map<string, Buffer>();
    for (const [version, encoded] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(version) || typeof encoded !== 'string') {
        throw new ServiceUnavailableException('Identity access lookup keyring is invalid.');
      }
      const key = Buffer.from(encoded, 'base64');
      if (key.byteLength !== 32 || key.toString('base64') !== encoded) {
        throw new ServiceUnavailableException('Identity access lookup keyring is invalid.');
      }
      keys.set(version, key);
    }
    if (!keys.has(activeVersion)) {
      throw new ServiceUnavailableException('Active identity access lookup key is unavailable.');
    }
    return { activeVersion, keys };
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
