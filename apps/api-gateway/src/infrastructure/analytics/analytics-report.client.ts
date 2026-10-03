import { Injectable } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const metricRow = z.object({
  date: dateOnly,
  branchesCreated: z.number().int().nonnegative(),
  branchStatusChanges: z.number().int().nonnegative(),
  devicesRegistered: z.number().int().nonnegative(),
  deviceUpdates: z.number().int().nonnegative(),
  healthOnline: z.number().int().nonnegative(),
  healthDegraded: z.number().int().nonnegative(),
  healthOffline: z.number().int().nonnegative(),
}).strict();
const reportSchema = z.object({
  scope: z.object({ scopeType: z.enum(['organization', 'branch']), organizationId: uuid, branchId: uuid.nullable() }).strict(),
  period: z.object({ from: dateOnly, to: dateOnly, timezone: z.literal('UTC'), days: z.number().int().min(1).max(366) }).strict(),
  snapshot: z.object({
    organizations: z.object({ active: z.number().int().nonnegative(), suspended: z.number().int().nonnegative(), archived: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }).strict(),
    branches: z.object({ active: z.number().int().nonnegative(), suspended: z.number().int().nonnegative(), archived: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }).strict(),
    devices: z.object({
      total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), suspended: z.number().int().nonnegative(), retired: z.number().int().nonnegative(), unknownLifecycle: z.number().int().nonnegative(),
      health: z.object({ online: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), offline: z.number().int().nonnegative(), stale: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }).strict(),
    }).strict(),
    branchBreakdown: z.array(z.object({
      branchId: uuid, branchName: z.string().nullable(), status: z.enum(['active', 'suspended', 'archived']), devicesTotal: z.number().int().nonnegative(),
      online: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), offline: z.number().int().nonnegative(), stale: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(),
    }).strict()).max(500),
    branchBreakdownTruncated: z.boolean(),
  }).strict(),
  daily: z.array(metricRow).min(1).max(366),
  totals: metricRow.omit({ date: true }).strict(),
  projection: z.object({ generationId: uuid, coverageStartedAt: z.string().datetime({ offset: true }).nullable(), lastEventAt: z.string().datetime({ offset: true }).nullable(), lastProcessedAt: z.string().datetime({ offset: true }).nullable(), asOf: z.string().datetime({ offset: true }) }).strict(),
}).strict();

export type AnalyticsReportFilter = {
  scopeType: 'organization' | 'branch';
  organizationId: string;
  branchId?: string;
  from: string;
  to: string;
};
export type AnalyticsReport = z.infer<typeof reportSchema>;
export type AnalyticsReportExport = Pick<AnalyticsReport, 'period' | 'daily'>;

@Injectable()
export class AnalyticsReportClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> { return fetch(input, init); }

  async getReport(filter: AnalyticsReportFilter): Promise<AnalyticsReport> {
    const query = new URLSearchParams({ scopeType: filter.scopeType, organizationId: filter.organizationId, from: filter.from, to: filter.to });
    if (filter.branchId) query.set('branchId', filter.branchId);
    const result = reportSchema.safeParse(await this.request(`/internal/v1/reports?${query.toString()}`));
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async exportReport(filter: AnalyticsReportFilter, actorUserId: string, correlationId: string): Promise<AnalyticsReportExport> {
    const result = z.object({ period: reportSchema.shape.period, daily: reportSchema.shape.daily }).strict().safeParse(
      await this.request('/internal/v1/reports/export', {
        method: 'POST',
        body: filter,
        actorUserId,
        correlationId,
      }),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  private async request(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; actorUserId?: string; correlationId?: string } = {}): Promise<unknown> {
    const baseUrl = process.env.ANALYTICS_READ_MODEL_URL;
    const token = process.env.ANALYTICS_API_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32) throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس گزارش‌دهی پیکربندی نشده است.');
    let url: URL;
    try {
      url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error();
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس گزارش‌دهی معتبر نیست.');
    }
    let response: Response;
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-funtino-service-id': 'api-gateway',
        'x-funtino-service-token': token,
        'cache-control': 'no-store',
      };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (options.actorUserId) headers['x-funtino-actor-user-id'] = options.actorUserId;
      if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(7_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس گزارش‌دهی در دسترس نیست.');
    }
    if (!response.ok) {
      if (response.status === 400) throw new DomainError('VALIDATION_ERROR', 'فیلتر گزارش معتبر نیست.');
      if (response.status === 429) throw new DomainError('RATE_LIMITED', 'درخواست‌های گزارش بیش از حد مجاز است.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس گزارش‌دهی پاسخ معتبر نداد.');
    }
    try { return await response.json(); }
    catch { throw this.contractError(); }
  }

  private contractError(): DomainError {
    return new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد گزارش با سرویس Analytics ناسازگار است.');
  }
}
