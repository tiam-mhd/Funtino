import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { assertReportFilter, type ReportFilter } from './report-query.js';

const maxBranchBreakdown = 500;

function deviceHealthThresholds(): { staleAfterSeconds: number; offlineAfterSeconds: number } {
  const staleAfterSeconds = Number(process.env.DEVICE_HEALTH_STALE_AFTER_SECONDS ?? 300);
  const offlineAfterSeconds = Number(process.env.DEVICE_HEALTH_OFFLINE_AFTER_SECONDS ?? 900);
  if (
    !Number.isSafeInteger(staleAfterSeconds) ||
    !Number.isSafeInteger(offlineAfterSeconds) ||
    staleAfterSeconds <= 0 ||
    offlineAfterSeconds <= staleAfterSeconds
  ) {
    throw new ServiceUnavailableException(
      'Device health thresholds are not configured consistently.',
    );
  }
  return { staleAfterSeconds, offlineAfterSeconds };
}

type MetricKey =
  | 'branch.created'
  | 'branch.status_changed'
  | 'device.registered'
  | 'device.updated'
  | 'device.health.online'
  | 'device.health.degraded'
  | 'device.health.offline';

type DailyRow = {
  date: string;
  branchesCreated: number;
  branchStatusChanges: number;
  devicesRegistered: number;
  deviceUpdates: number;
  healthOnline: number;
  healthDegraded: number;
  healthOffline: number;
};

export type OperationsReport = {
  scope: { scopeType: 'organization' | 'branch'; organizationId: string; branchId: string | null };
  period: { from: string; to: string; timezone: 'UTC'; days: number };
  snapshot: {
    organizations: { active: number; suspended: number; archived: number; unknown: number };
    branches: { active: number; suspended: number; archived: number; unknown: number };
    devices: {
      total: number;
      active: number;
      suspended: number;
      retired: number;
      unknownLifecycle: number;
      health: { online: number; degraded: number; offline: number; stale: number; unknown: number };
    };
    branchBreakdown: Array<{
      branchId: string;
      branchName: string | null;
      status: 'active' | 'suspended' | 'archived';
      devicesTotal: number;
      online: number;
      degraded: number;
      offline: number;
      stale: number;
      unknown: number;
    }>;
    branchBreakdownTruncated: boolean;
  };
  daily: DailyRow[];
  totals: Omit<DailyRow, 'date'>;
  projection: {
    generationId: string;
    coverageStartedAt: string | null;
    lastEventAt: string | null;
    lastProcessedAt: string | null;
    asOf: string;
  };
};

@Injectable()
export class OperationsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(input: unknown): Promise<OperationsReport> {
    const filter = assertReportFilter(input);
    return this.prisma.$transaction(async (tx) => this.queryReport(tx, filter), {
      isolationLevel: 'RepeatableRead',
      maxWait: 2_000,
      timeout: 8_000,
    });
  }

  async exportReport(
    input: unknown,
    actorUserId: string,
    correlationId: string,
  ): Promise<Pick<OperationsReport, 'period' | 'daily'>> {
    const filter = assertReportFilter(input);
    const actor = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      actorUserId,
    );
    const correlation =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        correlationId,
      );
    if (!actor || !correlation) throw new Error('INVALID_REPORT_EXPORT_AUDIT_CONTEXT');

    return this.prisma.$transaction(
      async (tx) => {
        const report = await this.queryReport(tx, filter);
        await tx.reportExportAudit.create({
          data: {
            id: randomUUID(),
            actorUserId,
            organizationId: filter.organizationId,
            branchId: filter.branchId ?? null,
            fromDay: filter.fromDay,
            toDay: filter.toDay,
            rowCount: report.daily.length,
            correlationId,
          },
        });
        return { period: report.period, daily: report.daily };
      },
      {
        isolationLevel: 'RepeatableRead',
        maxWait: 2_000,
        timeout: 8_000,
      },
    );
  }

  private async queryReport(
    tx: Prisma.TransactionClient,
    filter: ReportFilter & { fromDay: Date; toDay: Date },
  ): Promise<OperationsReport> {
    const { staleAfterSeconds, offlineAfterSeconds } = deviceHealthThresholds();
    const control = await tx.projectionControl.findUnique({ where: { id: 1 } });
    if (!control?.activeGenerationId)
      throw new ServiceUnavailableException('Analytics projection is not initialized.');
    const generationId = control.activeGenerationId;
    const branchWhere = filter.branchId ? { id: filter.branchId } : {};
    const branches = await tx.branchProjection.findMany({
      where: { generationId, organizationId: filter.organizationId, ...branchWhere },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: maxBranchBreakdown + 1,
      select: { id: true, name: true, status: true },
    });
    const branchBreakdownTruncated = branches.length > maxBranchBreakdown;
    const selectedBranches = branches.slice(0, maxBranchBreakdown);
    const branchIds = selectedBranches.map(({ id }) => id);
    const healthStateSql = Prisma.sql`
      CASE
        WHEN d.latest_observed_at IS NULL THEN 'unknown'
        WHEN d.latest_health = 'offline' OR d.latest_observed_at <= NOW() - (${offlineAfterSeconds} * INTERVAL '1 second') THEN 'offline'
        WHEN d.latest_observed_at <= NOW() - (${staleAfterSeconds} * INTERVAL '1 second') THEN 'stale'
        ELSE COALESCE(d.latest_health::text, 'unknown')
      END
    `;
    const branchHealthFilter = filter.branchId
      ? Prisma.sql`AND d.branch_id = ${filter.branchId}::uuid`
      : Prisma.sql``;
    const deviceTotals = await tx.$queryRaw<
      Array<{
        lifecycleStatus: string | null;
        healthState: string;
        count: number;
      }>
    >(Prisma.sql`
      SELECT d.status::text AS "lifecycleStatus", ${healthStateSql} AS "healthState", COUNT(*)::int AS count
      FROM analytics_read_model.device_projection d
      WHERE d.generation_id = ${generationId}::uuid
        AND d.organization_id = ${filter.organizationId}::uuid
        ${branchHealthFilter}
      GROUP BY d.status, "healthState"
    `);
    const branchDeviceGroups = branchIds.length
      ? await tx.$queryRaw<
          Array<{
            branchId: string;
            lifecycleStatus: string | null;
            healthState: string;
            count: number;
          }>
        >(Prisma.sql`
          SELECT d.branch_id AS "branchId", d.status::text AS "lifecycleStatus", ${healthStateSql} AS "healthState",
            COUNT(*)::int AS count
          FROM analytics_read_model.device_projection d
          WHERE d.generation_id = ${generationId}::uuid
            AND d.organization_id = ${filter.organizationId}::uuid
            AND d.branch_id IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})
          GROUP BY d.branch_id, d.status, "healthState"
        `)
      : [];
    const branchStats = new Map<string, OperationsReport['snapshot']['branchBreakdown'][number]>();
    for (const branch of selectedBranches) {
      branchStats.set(branch.id, {
        branchId: branch.id,
        branchName: branch.name,
        status: branch.status,
        devicesTotal: 0,
        online: 0,
        degraded: 0,
        offline: 0,
        stale: 0,
        unknown: 0,
      });
    }
    const deviceLifecycle = { active: 0, suspended: 0, retired: 0, unknown: 0 };
    const deviceHealth = { online: 0, degraded: 0, offline: 0, stale: 0, unknown: 0 };
    for (const group of deviceTotals) {
      const count = Number(group.count);
      if (group.lifecycleStatus === 'active') deviceLifecycle.active += count;
      else if (group.lifecycleStatus === 'suspended') deviceLifecycle.suspended += count;
      else if (group.lifecycleStatus === 'retired') deviceLifecycle.retired += count;
      else deviceLifecycle.unknown += count;
      if (group.healthState in deviceHealth) {
        deviceHealth[group.healthState as keyof typeof deviceHealth] += count;
      }
    }
    for (const group of branchDeviceGroups) {
      const branchStatsRow = branchStats.get(group.branchId);
      const count = Number(group.count);
      if (branchStatsRow) {
        branchStatsRow.devicesTotal += count;
        if (group.healthState in branchStatsRow) {
          branchStatsRow[
            group.healthState as 'online' | 'degraded' | 'offline' | 'stale' | 'unknown'
          ] += count;
        }
      }
    }

    const branchStatusGroups = await tx.branchProjection.groupBy({
      by: ['status'],
      where: { generationId, organizationId: filter.organizationId, ...branchWhere },
      _count: { _all: true },
    });
    const branchCounts = { active: 0, suspended: 0, archived: 0, unknown: 0 };
    for (const group of branchStatusGroups) branchCounts[group.status] = group._count._all;
    const organization = await tx.organizationProjection.findUnique({
      where: { generationId_id: { generationId, id: filter.organizationId } },
      select: { status: true },
    });
    const organizationCounts = {
      active: 0,
      suspended: 0,
      archived: 0,
      unknown: organization ? 0 : 1,
    };
    if (organization) organizationCounts[organization.status] = 1;

    const metricGroups = await tx.dailyOperationalMetric.groupBy({
      by: ['day', 'metricKey'],
      where: {
        generationId,
        organizationId: filter.organizationId,
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        day: { gte: filter.fromDay, lte: filter.toDay },
      },
      _sum: { count: true },
      orderBy: { day: 'asc' },
    });
    const metricMap = new Map<string, Partial<Record<MetricKey, number>>>();
    for (const group of metricGroups) {
      const date = group.day.toISOString().slice(0, 10);
      const values = metricMap.get(date) ?? {};
      if (isMetricKey(group.metricKey)) values[group.metricKey] = group._sum.count ?? 0;
      metricMap.set(date, values);
    }
    const daily: DailyRow[] = [];
    const cursor = new Date(filter.fromDay);
    while (cursor <= filter.toDay) {
      const date = cursor.toISOString().slice(0, 10);
      const values = metricMap.get(date) ?? {};
      daily.push({
        date,
        branchesCreated: values['branch.created'] ?? 0,
        branchStatusChanges: values['branch.status_changed'] ?? 0,
        devicesRegistered: values['device.registered'] ?? 0,
        deviceUpdates: values['device.updated'] ?? 0,
        healthOnline: values['device.health.online'] ?? 0,
        healthDegraded: values['device.health.degraded'] ?? 0,
        healthOffline: values['device.health.offline'] ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const totals = daily.reduce<Omit<DailyRow, 'date'>>(
      (sum, row) => ({
        branchesCreated: sum.branchesCreated + row.branchesCreated,
        branchStatusChanges: sum.branchStatusChanges + row.branchStatusChanges,
        devicesRegistered: sum.devicesRegistered + row.devicesRegistered,
        deviceUpdates: sum.deviceUpdates + row.deviceUpdates,
        healthOnline: sum.healthOnline + row.healthOnline,
        healthDegraded: sum.healthDegraded + row.healthDegraded,
        healthOffline: sum.healthOffline + row.healthOffline,
      }),
      {
        branchesCreated: 0,
        branchStatusChanges: 0,
        devicesRegistered: 0,
        deviceUpdates: 0,
        healthOnline: 0,
        healthDegraded: 0,
        healthOffline: 0,
      },
    );

    return {
      scope: {
        scopeType: filter.scopeType,
        organizationId: filter.organizationId,
        branchId: filter.branchId ?? null,
      },
      period: {
        from: filter.from,
        to: filter.to,
        timezone: 'UTC',
        days: daily.length,
      },
      snapshot: {
        organizations: organizationCounts,
        branches: branchCounts,
        devices: {
          total: Object.values(deviceLifecycle).reduce((sum, count) => sum + count, 0),
          active: deviceLifecycle.active,
          suspended: deviceLifecycle.suspended,
          retired: deviceLifecycle.retired,
          unknownLifecycle: deviceLifecycle.unknown,
          health: deviceHealth,
        },
        branchBreakdown: [...branchStats.values()],
        branchBreakdownTruncated,
      },
      daily,
      totals,
      projection: {
        generationId,
        coverageStartedAt: control.coverageStartedAt?.toISOString() ?? null,
        lastEventAt: control.lastEventAt?.toISOString() ?? null,
        lastProcessedAt: control.lastProcessedAt?.toISOString() ?? null,
        asOf: new Date().toISOString(),
      },
    };
  }
}

function isMetricKey(value: string): value is MetricKey {
  return [
    'branch.created',
    'branch.status_changed',
    'device.registered',
    'device.updated',
    'device.health.online',
    'device.health.degraded',
    'device.health.offline',
  ].includes(value);
}
