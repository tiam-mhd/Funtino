import { Injectable } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { generateOtpCode, type OtpSender, type OtpSendResult } from './otp-sender.js';

type ParsGreenResponse = {
  R_Success?: boolean | number | string;
  R_Code?: number | string;
  R_Message?: string;
  success?: boolean | number | string;
  message?: string;
  [key: string]: unknown;
};

const DEFAULT_PARS_GREEN_OTP_URL = 'https://sms.parsgreen.ir/Apiv2/Message/SendOtp';
const DEFAULT_PARS_GREEN_AUTH_HEADER = 'Authorization';

@Injectable()
export class ParsGreenOtpSender implements OtpSender {
  async sendOtp(phoneE164: string): Promise<OtpSendResult> {
    const code = generateOtpCode();
    const token = process.env.PARSGREEN_API_TOKEN?.trim();

    if (!token) {
      if (process.env.NODE_ENV === 'production') {
        throw new DomainError(
          'DEPENDENCY_UNAVAILABLE',
          'سرویس ارسال کد فعال نشده است. توکن Parsgreen را در تنظیمات سرور قرار دهید.',
        );
      }
      return { code, provider: 'local', deliveryStatus: 'confirmed' };
    }

    const endpoint = process.env.PARSGREEN_OTP_URL?.trim() || DEFAULT_PARS_GREEN_OTP_URL;
    const authHeader = process.env.PARSGREEN_AUTH_HEADER?.trim() || DEFAULT_PARS_GREEN_AUTH_HEADER;
    const authValue =
      authHeader.toLowerCase() === 'authorization' ? `basic apikey:${token}` : token;
    const timeoutMs = Number(process.env.PARSGREEN_REQUEST_TIMEOUT_MS ?? 8000);
    const templateId = Number(process.env.PARSGREEN_OTP_TEMPLATE_ID ?? 0);
    const mobile = toParsGreenMobile(phoneE164);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let providerStatus: number | undefined;
    let providerPayload: ParsGreenResponse | undefined;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          [authHeader]: authValue,
        },
        body: JSON.stringify({
          Mobile: mobile,
          SmsCode: code,
          TemplateId: templateId,
          AddName: process.env.PARSGREEN_ADD_NAME === 'true',
        }),
        signal: controller.signal,
      });

      providerStatus = response.status;
      providerPayload = await parseResponse(response);
      if (!response.ok || !isSuccessful(providerPayload)) {
        throw new Error(
          providerPayload.R_Message ?? providerPayload.message ?? `HTTP ${response.status}`,
        );
      }
      return { code, provider: 'parsgreen', deliveryStatus: 'confirmed' };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const reason =
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider_error';
      const providerMessage = sanitizeProviderMessage(
        providerPayload?.R_Message ?? providerPayload?.message,
        token,
      );
      const diagnostic = JSON.stringify({
        reason,
        status: providerStatus,
        code: providerPayload?.R_Code,
        message: providerMessage,
      });
      if (reason === 'timeout') {
        console.warn(`[otp] Parsgreen delivery status uncertain: ${diagnostic}`);
        return { code, provider: 'parsgreen', deliveryStatus: 'unknown' };
      }
      console.error(`[otp] Parsgreen request failed: ${diagnostic}`);
      throw new DomainError(
        'DEPENDENCY_UNAVAILABLE',
        'ارسال کد تأیید موقتاً ممکن نیست. لطفاً دوباره تلاش کنید.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sanitizeProviderMessage(value: unknown, token: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const message = value.replace(/\s+/g, ' ').trim();
  if (!message) return undefined;
  return message.replaceAll(token, '[REDACTED]').slice(0, 200);
}

async function parseResponse(response: Response): Promise<ParsGreenResponse> {
  const text = await response.text();
  if (!text) return {} as ParsGreenResponse;
  try {
    return unwrapResponse(JSON.parse(text));
  } catch {
    return { R_Message: text.slice(0, 200) };
  }
}

function isSuccessful(payload: ParsGreenResponse): boolean {
  const value = payload.R_Success ?? payload.success;
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    (typeof value === 'string' && value.trim().toLowerCase() === 'true')
  );
}

function unwrapResponse(value: unknown): ParsGreenResponse {
  if (typeof value === 'string') {
    try {
      return unwrapResponse(JSON.parse(value));
    } catch {
      return { R_Message: value.slice(0, 200) };
    }
  }
  if (typeof value !== 'object' || value === null) return {};
  if ('d' in value) return unwrapResponse((value as { d?: unknown }).d);
  return value as ParsGreenResponse;
}

function toParsGreenMobile(phoneE164: string): string {
  return phoneE164.startsWith('+98') ? `0${phoneE164.slice(3)}` : phoneE164;
}
