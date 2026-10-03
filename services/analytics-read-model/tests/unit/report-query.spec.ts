import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { assertReportFilter } from '../../src/application/report-query.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const to = today.toISOString().slice(0, 10);
const start = new Date(today);
start.setUTCDate(start.getUTCDate() - 365);
const maxRangeFrom = start.toISOString().slice(0, 10);

test('report filter accepts a bounded inclusive 366-day UTC range', () => {
  const result = assertReportFilter({
    scopeType: 'organization',
    organizationId,
    from: maxRangeFrom,
    to,
  });
  assert.equal(result.fromDay.toISOString().slice(0, 10), maxRangeFrom);
  assert.equal(result.toDay.toISOString().slice(0, 10), to);
});

test('report filter rejects invalid calendar dates, overlong periods, and future dates', () => {
  for (const filter of [
    { scopeType: 'organization', organizationId, from: '2026-02-30', to },
    { scopeType: 'organization', organizationId, from: '2025-01-01', to },
    { scopeType: 'organization', organizationId, from: to, to: nextDay(to) },
  ]) {
    assert.throws(() => assertReportFilter(filter), BadRequestException);
  }
});

test('branch scope requires exactly one branch ID and rejects unknown fields', () => {
  assert.throws(
    () => assertReportFilter({ scopeType: 'branch', organizationId, from: to, to }),
    BadRequestException,
  );
  assert.throws(
    () => assertReportFilter({ scopeType: 'organization', organizationId, branchId, from: to, to }),
    BadRequestException,
  );
  assert.throws(
    () =>
      assertReportFilter({
        scopeType: 'branch',
        organizationId,
        branchId,
        from: to,
        to,
        actorUserId: organizationId,
      }),
    BadRequestException,
  );
});

function nextDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
