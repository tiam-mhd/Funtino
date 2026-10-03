import { Injectable } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const deviceSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    branchId: uuid,
    adapterKey: z.string().min(1).max(60),
    externalDeviceId: z.string().min(1).max(160),
    displayName: z.string().min(1).max(120),
    deviceType: z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']),
    status: z.enum(['active', 'suspended', 'retired']),
    healthState: z.enum(['unknown', 'online', 'degraded', 'stale', 'offline']),
    latestReportedState: z.enum(['online', 'degraded', 'offline']).nullable(),
    latestObservedAt: z.string().datetime({ offset: true }).nullable(),
    freshnessSeconds: z.number().int().min(0).nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const devicePageSchema = z
  .object({ items: z.array(deviceSchema), nextCursor: uuid.nullable() })
  .strict();
const commandResultSchema = z
  .object({
    deviceId: uuid,
    status: z.enum(['active', 'suspended', 'retired']),
    version: z.number().int().positive(),
  })
  .strict();

export type DeviceView = z.infer<typeof deviceSchema>;
export type DevicePage = z.infer<typeof devicePageSchema>;
export type DeviceCommandResult = z.infer<typeof commandResultSchema>;
export type DeviceCommandMeta = {
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

@Injectable()
export class DeviceIntegrationClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async listDevices(input: {
    organizationId: string;
    branchId?: string;
    status?: 'active' | 'suspended' | 'retired';
    cursor?: string;
    pageSize: number;
  }): Promise<DevicePage> {
    const query = new URLSearchParams({ pageSize: String(input.pageSize) });
    if (input.branchId) query.set('branchId', input.branchId);
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    const result = devicePageSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(input.organizationId)}/devices?${query}`,
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async registerDevice(
    organizationId: string,
    branchId: string,
    input: {
      adapterKey: string;
      externalDeviceId: string;
      displayName: string;
      deviceType: DeviceView['deviceType'];
      reason: string;
    },
    meta: DeviceCommandMeta,
  ): Promise<DeviceCommandResult> {
    const result = commandResultSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/devices`,
        { method: 'POST', body: input, command: meta },
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async updateDevice(
    organizationId: string,
    branchId: string,
    deviceId: string,
    version: number,
    input: { displayName?: string; status?: DeviceView['status']; reason: string },
    meta: DeviceCommandMeta,
  ): Promise<DeviceCommandResult> {
    const result = commandResultSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/devices/${encodeURIComponent(deviceId)}`,
        { method: 'PATCH', body: input, version, command: meta },
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH';
      body?: unknown;
      version?: number;
      command?: DeviceCommandMeta;
    } = {},
  ): Promise<unknown> {
    const baseUrl = process.env.DEVICE_INTEGRATION_URL;
    const token = process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت دستگاه پیکربندی نشده است.');
    }
    let url: URL;
    try {
      url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        throw new Error('Invalid service URL');
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس مدیریت دستگاه معتبر نیست.');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-funtino-service-id': 'api-gateway',
      'x-funtino-service-token': token,
      'cache-control': 'no-store',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.command) {
      headers['x-funtino-actor-user-id'] = options.command.actorUserId;
      headers['x-correlation-id'] = options.command.correlationId;
      headers['idempotency-key'] = options.command.idempotencyKey;
    }
    if (options.version !== undefined) headers['if-match'] = `"${options.version}"`;

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت دستگاه در دسترس نیست.');
    }
    if (!response.ok) {
      if (response.status === 404)
        throw new DomainError('NOT_FOUND', 'دستگاه، مجموعه یا شعبه پیدا نشد.');
      if (response.status === 409)
        throw new DomainError(
          'CONFLICT',
          'عملیات با وضعیت فعلی تعارض دارد؛ فهرست را تازه کنید و شناسه‌ی ثبت را بررسی کنید.',
        );
      if (response.status === 400 || response.status === 422) {
        throw new DomainError('VALIDATION_ERROR', 'اطلاعات ارسالی برای دستگاه معتبر نیست.');
      }
      if (response.status === 429)
        throw new DomainError('RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس مدیریت دستگاه معتبر نیست.');
    }
    try {
      return await response.json();
    } catch {
      throw this.contractError();
    }
  }

  private contractError(): DomainError {
    return new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد سرویس مدیریت دستگاه ناسازگار است.');
  }
}
