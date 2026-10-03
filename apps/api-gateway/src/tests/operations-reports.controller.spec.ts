import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';
import type { AnalyticsReportClient } from '../infrastructure/analytics/analytics-report.client.js';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import { OperationsReportsController } from '../interfaces/http/operations-reports.controller.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';
const period = { from: '2026-09-01', to: '2026-09-30', timezone: 'UTC' as const, days: 30 };
const emptyTotals = {
  branchesCreated: 0,
  branchStatusChanges: 0,
  devicesRegistered: 0,
  deviceUpdates: 0,
  healthOnline: 0,
  healthDegraded: 0,
  healthOffline: 0,
};

function dailyRows() {
  return Array.from({ length: period.days }, (_, index) => {
    const date = new Date(`${period.from}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), ...emptyTotals };
  });
}

function request(): AuthenticatedRequest {
  return {
    session: { id: 'session', userId } as never,
    requestId: 'request-1',
    correlationId,
  } as unknown as AuthenticatedRequest;
}

function report(
  scopeType: 'organization' | 'branch',
  id: string,
  overrides: {
    period?: typeof period;
    daily?: ReturnType<typeof dailyRows>;
    totals?: typeof emptyTotals;
  } = {},
) {
  return {
    scope: { scopeType, organizationId, branchId: scopeType === 'branch' ? id : null },
    period: overrides.period ?? period,
    snapshot: {},
    daily: overrides.daily ?? dailyRows(),
    totals: overrides.totals ?? emptyTotals,
    projection: {},
  } as never;
}

function makeController(
  authorize: (permission: string, scope: unknown) => Promise<boolean | 'step_up_required'>,
  analytics: Partial<AnalyticsReportClient>,
  ownerCalls: string[] = [],
) {
  const identity = {
    evaluateAuthorization: async (
      _user: string,
      _session: unknown,
      input: { permission: string; scope: unknown },
    ) => {
      const decision = await authorize(input.permission, input.scope);
      return {
        allowed: decision === true,
        ...(decision === 'step_up_required' ? { reason: decision } : {}),
        policyVersion: 1,
        catalogVersion: 1,
      };
    },
  } as unknown as IdentityAccessClient;
  const organizationBranch = {
    getOrganization: async (id: string) => {
      ownerCalls.push(`organization:${id}`);
      return { status: 'active' } as never;
    },
    getOrganizationBranch: async (_organizationId: string, id: string) => {
      ownerCalls.push(`branch:${id}`);
      return { id, organizationId, status: 'active' } as never;
    },
  } as unknown as OrganizationBranchClient;
  return new OperationsReportsController(
    identity,
    organizationBranch,
    analytics as AnalyticsReportClient,
  );
}

test('read authorization is checked for the exact branch before owner or Analytics access', async () => {
  let analyticsCalled = false;
  const ownerCalls: string[] = [];
  const controller = makeController(
    async () => false,
    {
      getReport: async () => {
        analyticsCalled = true;
        return report('branch', branchId);
      },
    },
    ownerCalls,
  );

  await assert.rejects(
    controller.getReport(
      { id: userId },
      { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(analyticsCalled, false);
  assert.deepEqual(ownerCalls, []);
});

test('report response exposes export capability only after server-side IAM evaluation', async () => {
  const checks: Array<{ permission: string; scope: unknown }> = [];
  const controller = makeController(
    async (permission, scope) => {
      checks.push({ permission, scope });
      return permission === 'report.read';
    },
    {
      getReport: async () => report('branch', branchId),
    },
  );

  const result = await controller.getReport(
    { id: userId },
    { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
    request(),
  );
  assert.equal(result.data.capabilities.canExport, false);
  assert.deepEqual(checks, [
    { permission: 'report.read', scope: { type: 'branch', organizationId, branchId } },
    { permission: 'report.export', scope: { type: 'branch', organizationId, branchId } },
  ]);
});

test('a report.export step-up decision leaves the MFA entry point available without authorizing export', async () => {
  const controller = makeController(
    async (permission) => (permission === 'report.read' ? true : 'step_up_required'),
    {
      getReport: async () => report('branch', branchId),
    },
  );
  const result = await controller.getReport(
    { id: userId },
    { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
    request(),
  );
  assert.equal(result.data.capabilities.canExport, true);
});

test('read rejects a report whose date rows do not exactly cover the requested UTC period', async () => {
  const controller = makeController(async (permission) => permission === 'report.read', {
    getReport: async () => report('branch', branchId, { daily: [] }),
  });
  await assert.rejects(
    controller.getReport(
      { id: userId },
      { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
  );
});

test('read rejects totals that do not equal the sum of daily metrics', async () => {
  const controller = makeController(async (permission) => permission === 'report.read', {
    getReport: async () =>
      report('branch', branchId, { totals: { ...emptyTotals, healthOnline: 1 } }),
  });
  await assert.rejects(
    controller.getReport(
      { id: userId },
      { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'DEPENDENCY_UNAVAILABLE',
  );
});

test('export requires report.export and forwards only server-derived actor and correlation for audit', async () => {
  let forwarded: unknown;
  const controller = makeController(async (permission) => permission === 'report.export', {
    exportReport: async (filter, actor, correlation) => {
      forwarded = { filter, actor, correlation };
      return { period, daily: dailyRows() };
    },
  });
  const result = await controller.exportReport(
    { id: userId },
    { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
    request(),
  );
  assert.deepEqual(forwarded, {
    filter: { scopeType: 'branch', organizationId, branchId, from: period.from, to: period.to },
    actor: userId,
    correlation: correlationId,
  });
  assert.equal(result.data.period.from, period.from);
});
