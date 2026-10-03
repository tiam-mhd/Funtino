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
}
