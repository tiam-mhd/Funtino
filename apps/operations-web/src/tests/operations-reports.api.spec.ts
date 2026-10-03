import assert from 'node:assert/strict';
import test from 'node:test';
import { exportOperationsReport, getOperationsReport } from '../lib/api/operations-reports';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';

async function withFetchStub<T>(
  stub: (input: RequestInfo | URL, init?: RequestInit) => Response,
  run: () => Promise<T>,
) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => stub(input, init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function successResponse(data: unknown) {
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('report reads send the selected branch/date scope with session-only no-store semantics', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/v1/operations/reports');
      assert.equal(url.searchParams.get('scopeType'), 'branch');
      assert.equal(url.searchParams.get('organizationId'), organizationId);
      assert.equal(url.searchParams.get('branchId'), branchId);
      assert.equal(url.searchParams.get('from'), '2026-09-01');
      assert.equal(url.searchParams.get('to'), '2026-09-30');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return successResponse({
        scope: { scopeType: 'branch', organizationId, branchId },
        daily: [],
      });
    },
    async () => {
      const result = await getOperationsReport(
        { type: 'branch', organizationId, branchId },
        '2026-09-01',
        '2026-09-30',
      );
      assert.equal(result.scope.branchId, branchId);
    },
  );
});

test('organization export omits branch scope and sends only the bounded date filter', async () => {
  await withFetchStub(
    (input, init) => {
      assert.equal(String(input), 'http://localhost:4000/api/v1/operations/reports/export');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        scopeType: 'organization',
        organizationId,
        from: '2026-09-01',
        to: '2026-09-30',
      });
      return successResponse({
        period: { from: '2026-09-01', to: '2026-09-30', timezone: 'UTC', days: 30 },
        daily: [],
      });
    },
    async () => {
      const result = await exportOperationsReport(
        { type: 'organization', organizationId },
        '2026-09-01',
        '2026-09-30',
      );
      assert.equal(result.period.days, 30);
    },
  );
});
