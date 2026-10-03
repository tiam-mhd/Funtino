import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import { ParsGreenOtpSender } from '../infrastructure/notifications/pars-green-otp.sender.js';

const runtimeKeys = [
  'NODE_ENV',
  'PARSGREEN_API_TOKEN',
  'PARSGREEN_AUTH_HEADER',
  'PARSGREEN_OTP_URL',
  'PARSGREEN_OTP_TEMPLATE_ID',
  'PARSGREEN_ADD_NAME',
  'PARSGREEN_REQUEST_TIMEOUT_MS',
] as const;

function restoreRuntime(previous: Map<string, string | undefined>): void {
  for (const key of runtimeKeys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function captureRuntime(): Map<string, string | undefined> {
  return new Map(runtimeKeys.map((key) => [key, process.env[key]]));
}

test('ParsGreen adapter sends the published REST OTP contract', async () => {
  const previousRuntime = captureRuntime();
  const previousFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  process.env.NODE_ENV = 'production';
  process.env.PARSGREEN_API_TOKEN = 'unit-test-token';
  delete process.env.PARSGREEN_AUTH_HEADER;
  process.env.PARSGREEN_OTP_URL = 'https://sms.parsgreen.ir/Apiv2/Message/SendOtp';
  process.env.PARSGREEN_OTP_TEMPLATE_ID = '42';
  process.env.PARSGREEN_ADD_NAME = 'false';
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ R_Success: true, R_Code: 0, R_Message: 'OK' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await new ParsGreenOtpSender().sendOtp('+989121234567');
    const headers = new Headers(requestInit?.headers);
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;

    assert.equal(result.provider, 'parsgreen');
    assert.equal(result.deliveryStatus, 'confirmed');
    assert.match(result.code, /^\d{6}$/);
    assert.equal(requestUrl, 'https://sms.parsgreen.ir/Apiv2/Message/SendOtp');
    assert.equal(requestInit?.method, 'POST');
    assert.equal(headers.get('authorization'), 'basic apikey:unit-test-token');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.deepEqual(body, {
      Mobile: '09121234567',
      SmsCode: result.code,
      TemplateId: 42,
      AddName: false,
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreRuntime(previousRuntime);
  }
});

test('ParsGreen timeout preserves an uncertain delivery result for OTP verification', async () => {
  const previousRuntime = captureRuntime();
  const previousFetch = globalThis.fetch;

  process.env.NODE_ENV = 'production';
  process.env.PARSGREEN_API_TOKEN = 'unit-test-token';
  delete process.env.PARSGREEN_AUTH_HEADER;
  process.env.PARSGREEN_OTP_URL = 'https://sms.parsgreen.ir/Apiv2/Message/SendOtp';
  process.env.PARSGREEN_REQUEST_TIMEOUT_MS = '5';
  globalThis.fetch = (async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    })) as typeof fetch;

  try {
    const result = await new ParsGreenOtpSender().sendOtp('+989121234567');
    assert.equal(result.provider, 'parsgreen');
    assert.equal(result.deliveryStatus, 'unknown');
    assert.match(result.code, /^\d{6}$/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreRuntime(previousRuntime);
  }
});

test('ParsGreen business failure is mapped to a dependency error', async () => {
  const previousRuntime = captureRuntime();
  const previousFetch = globalThis.fetch;

  process.env.NODE_ENV = 'production';
  process.env.PARSGREEN_API_TOKEN = 'unit-test-token';
  delete process.env.PARSGREEN_AUTH_HEADER;
  process.env.PARSGREEN_OTP_URL = 'https://sms.parsgreen.ir/Apiv2/Message/SendOtp';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ R_Success: false, R_Code: 401, R_Message: 'invalid token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => new ParsGreenOtpSender().sendOtp('+989121234567'),
      (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreRuntime(previousRuntime);
  }
});
