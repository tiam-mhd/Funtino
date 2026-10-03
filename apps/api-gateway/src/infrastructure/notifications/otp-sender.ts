import { randomInt } from 'node:crypto';

export const OTP_SENDER = Symbol('OTP_SENDER');

export type OtpDeliveryStatus = 'confirmed' | 'unknown';

export type OtpSendResult = {
  code: string;
  provider: 'local' | 'parsgreen';
  deliveryStatus: OtpDeliveryStatus;
};

export interface OtpSender {
  sendOtp(phoneE164: string): Promise<OtpSendResult>;
}

export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export class LocalOtpSender implements OtpSender {
  async sendOtp(): Promise<OtpSendResult> {
    return { code: generateOtpCode(), provider: 'local', deliveryStatus: 'confirmed' };
  }
}
