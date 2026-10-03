import { Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DomainError } from '@funtino/backend-core';
import {
  AnalyticsReportClient,
  type AnalyticsReport,
} from '../../infrastructure/analytics/analytics-report.client.js';
import {
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reportMetricKeys = [
  'branchesCreated',
  'branchStatusChanges',
  'devicesRegistered',
  'deviceUpdates',
  'healthOnline',
  'healthDegraded',
  'healthOffline',
] as const;
const reportFilterSchema = z
  .object({
    scopeType: z.enum(['organization', 'branch']),
    organizationId: uuid,
    branchId: uuid.optional(),
    from: dateOnly,
    to: dateOnly,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.scopeType === 'branch') !== Boolean(value.branchId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Report scope is invalid.' });
    }
    const from = parseDate(value.from);
    const to = parseDate(value.to);
    if (!from || !to || to < from || (to.getTime() - from.getTime()) / 86_400_000 + 1 > 366) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Report date range is invalid.' });
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (to > today)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Future report dates are not supported.',
        });
    }
  });

@Controller('api/v1/operations/reports')
@UseGuards(SessionGuard)
export class OperationsReportsController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly analytics: AnalyticsReportClient,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async getReport(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(reportFilterSchema)) filter: z.infer<typeof reportFilterSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope = this.scopeFor(filter);
    await this.authorize(user.id, request, 'report.read', scope, correlationId);
    await this.assertActiveScope(filter.organizationId, filter.branchId);
    const [report, exportDecision] = await Promise.all([
      this.analytics.getReport(filter),
      this.allowed(user.id, request, 'report.export', scope, correlationId),
    ]);
    this.assertReturnedScope(report.scope, filter);
    this.assertReturnedPeriod(report.period, report.daily, filter);
    for (const key of reportMetricKeys) {
      const total = report.daily.reduce((sum, row) => sum + row[key], 0);
      if (!Number.isSafeInteger(total) || report.totals[key] !== total) {
        throw new DomainError('DEPENDENCY_UNAVAILABLE', 'جمع شاخص‌های گزارش ناسازگار است.');
      }
    }
    const canExport =
      exportDecision.allowed ||
      ('reason' in exportDecision && exportDecision.reason === 'step_up_required');
    return success({ ...report, capabilities: { canExport } }, request);
  }

  @Post('export')
  @UseGuards(TrustedOriginGuard)
  @Header('Cache-Control', 'private, no-store')
  async exportReport(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(reportFilterSchema)) filter: z.infer<typeof reportFilterSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope = this.scopeFor(filter);
    await this.authorize(user.id, request, 'report.export', scope, correlationId);
    await this.assertActiveScope(filter.organizationId, filter.branchId);
    const report = await this.analytics.exportReport(filter, user.id, correlationId);
    this.assertReturnedPeriod(report.period, report.daily, filter);
    return success(report, request);
  }

  private scopeFor(filter: z.infer<typeof reportFilterSchema>): AccessScopeDto {
    return filter.scopeType === 'organization'
      ? { type: 'organization', organizationId: filter.organizationId }
      : { type: 'branch', organizationId: filter.organizationId, branchId: filter.branchId! };
  }

  private async authorize(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    correlationId: string,
  ) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    const result = await this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope },
      correlationId,
    );
    if (!result.allowed)
      throw new DomainError(
        'FORBIDDEN',
        'برای مشاهده یا دریافت خروجی این گزارش مجوز لازم را ندارید.',
      );
  }

  private async allowed(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    correlationId: string,
  ) {
    if (!request.session) return { allowed: false as const };
    return this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope },
      correlationId,
    );
  }

  private async assertActiveScope(organizationId: string, branchId?: string) {
    const organization = await this.organizationBranch.getOrganization(organizationId);
    if (organization.status !== 'active')
      throw new DomainError('CONFLICT', 'مجموعه در وضعیت فعال نیست.');
    if (branchId) {
      const branch = await this.organizationBranch.getOrganizationBranch(organizationId, branchId);
      if (branch.organizationId.toLowerCase() !== organizationId.toLowerCase())
        throw new DomainError('NOT_FOUND', 'شعبه در این مجموعه پیدا نشد.');
      if (branch.status !== 'active') throw new DomainError('CONFLICT', 'شعبه در وضعیت فعال نیست.');
    }
  }

  private assertReturnedScope(
    actual: {
      scopeType: 'organization' | 'branch';
      organizationId: string;
      branchId: string | null;
    },
    requested: z.infer<typeof reportFilterSchema>,
  ) {
    if (
      actual.scopeType !== requested.scopeType ||
      actual.organizationId.toLowerCase() !== requested.organizationId.toLowerCase() ||
      (actual.branchId?.toLowerCase() ?? null) !== (requested.branchId?.toLowerCase() ?? null)
    ) {
      throw new DomainError(
        'DEPENDENCY_UNAVAILABLE',
        'محدوده‌ی پاسخ گزارش با درخواست هماهنگ نیست.',
      );
    }
  }

  private assertReturnedPeriod(
    period: AnalyticsReport['period'],
    daily: AnalyticsReport['daily'],
    requested: Pick<z.infer<typeof reportFilterSchema>, 'from' | 'to'>,
  ) {
    const from = parseDate(requested.from);
    const to = parseDate(requested.to);
    const expectedDays = from && to ? (to.getTime() - from.getTime()) / 86_400_000 + 1 : Number.NaN;
    const periodIsConsistent =
      from !== null &&
      to !== null &&
      period.from === requested.from &&
      period.to === requested.to &&
      period.timezone === 'UTC' &&
      period.days === expectedDays &&
      daily.length === expectedDays;
    if (!periodIsConsistent) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد بازه‌ی گزارش ناسازگار است.');
    }

    for (let index = 0; index < daily.length; index += 1) {
      const expectedDate = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10);
      if (daily[index]?.date !== expectedDate) {
        throw new DomainError('DEPENDENCY_UNAVAILABLE', 'ترتیب روزهای گزارش ناسازگار است.');
      }
    }
  }
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
