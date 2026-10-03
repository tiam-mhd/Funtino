import { apiRequest } from './client';
import type { OperationsScope } from '../auth/operations-access';

export type OperationsDailyReportRow = {
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
  daily: OperationsDailyReportRow[];
  totals: Omit<OperationsDailyReportRow, 'date'>;
  projection: {
    generationId: string;
    coverageStartedAt: string | null;
    lastEventAt: string | null;
    lastProcessedAt: string | null;
    asOf: string;
  };
  capabilities: { canExport: boolean };
};

export type OperationsReportExport = {
  period: OperationsReport['period'];
  daily: OperationsDailyReportRow[];
};

function reportPath(scope: OperationsScope, from: string, to: string) {
  const query = new URLSearchParams({
    scopeType: scope.type,
    organizationId: scope.organizationId,
    from,
    to,
  });
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  return `/api/v1/operations/reports?${query.toString()}`;
}

function reportFilter(scope: OperationsScope, from: string, to: string) {
  return {
    scopeType: scope.type,
    organizationId: scope.organizationId,
    ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
    from,
    to,
  };
}

export function getOperationsReport(scope: OperationsScope, from: string, to: string) {
  return apiRequest<OperationsReport>(reportPath(scope, from, to));
}

export function exportOperationsReport(scope: OperationsScope, from: string, to: string) {
  return apiRequest<OperationsReportExport>('/api/v1/operations/reports/export', {
    method: 'POST',
    body: reportFilter(scope, from, to),
  });
}
