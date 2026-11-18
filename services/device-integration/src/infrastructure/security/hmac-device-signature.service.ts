import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeviceSignatureVerifier } from '../../application/ports/device-signature-verifier.port.js';

@Injectable()
export class HmacDeviceSignatureService implements DeviceSignatureVerifier {
  isConfigured(): boolean {
    const secret = process.env.DEVICE_WEBHOOK_SECRET;
    return Boolean(secret && secret.length >= 32);
  }

  verify(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = process.env.DEVICE_WEBHOOK_SECRET;
    if (!secret || secret.length < 32 || !signature || signature.length > 80) return false;
    const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
    if (!match) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(match[1], 'hex');
    return supplied.length === expected.length && timingSafeEqual(expected, supplied);
  }

  isEdgeConfigured(): boolean {
    return Object.keys(readEdgeKeys()).length > 0;
  }

  verifyEdge(rawBody: Buffer, keyId: string | undefined, signature: string | undefined): boolean {
    if (!keyId || keyId.length > 120 || !signature || signature.length > 80) return false;
    const secret = readEdgeKeys()[keyId];
    if (!secret) return false;
    const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
    if (!match) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(match[1], 'hex');
    return supplied.length === expected.length && timingSafeEqual(expected, supplied);
  }
}

function readEdgeKeys(): Record<string, string> {
  const raw = process.env.DEVICE_EDGE_HMAC_KEYS?.trim();
  if (!raw || raw.length > 64_000) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/u.test(key) &&
          typeof value === 'string' &&
          value.length >= 32 &&
          value.length <= 512,
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
