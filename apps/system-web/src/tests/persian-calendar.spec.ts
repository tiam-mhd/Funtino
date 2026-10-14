import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPersianNumber,
  getJalaliMonthDates,
  gregorianToJalali,
  isDateWithinBounds,
  jalaliToGregorian,
  joinLocalDateTime,
  parseLocalDateTime,
  parseTimeValue,
  toAsciiDigits,
} from '../../../../packages/design-system/src/components/date-time/persian-calendar';

test('converts Gregorian dates across Nowruz without timezone drift', () => {
  assert.deepEqual(gregorianToJalali('2025-03-20'), { year: 1403, month: 12, day: 30 });
  assert.deepEqual(gregorianToJalali('2025-03-21'), { year: 1404, month: 1, day: 1 });
  assert.equal(jalaliToGregorian({ year: 1403, month: 12, day: 30 }), '2025-03-20');
  assert.equal(jalaliToGregorian({ year: 1404, month: 12, day: 30 }), null);
});

test('returns the correct day count for Jalali months', () => {
  assert.equal(getJalaliMonthDates(1404, 1).length, 31);
  assert.equal(getJalaliMonthDates(1404, 7).length, 30);
  assert.equal(getJalaliMonthDates(1403, 12).length, 30);
  assert.equal(getJalaliMonthDates(1404, 12).length, 29);
});

test('normalizes Persian and Arabic digits and formats two digit values', () => {
  assert.equal(toAsciiDigits('۱۴۰۴/١٢:۳۴'), '1404/12:34');
  assert.equal(formatPersianNumber(7, 2), '۰۷');
});

test('accepts only 24-hour times from 00:00 through 23:59', () => {
  assert.deepEqual(parseTimeValue('۰۰:۰۰'), { hour: 0, minute: 0 });
  assert.deepEqual(parseTimeValue('23:59'), { hour: 23, minute: 59 });
  assert.equal(parseTimeValue('24:00'), null);
  assert.equal(parseTimeValue('12:60'), null);
});

test('keeps local datetime strings unchanged for existing API conversion', () => {
  const value = joinLocalDateTime('2025-03-20', '23:45');
  assert.equal(value, '2025-03-20T23:45');
  assert.deepEqual(parseLocalDateTime(value ?? ''), { date: '2025-03-20', time: '23:45' });
});

test('respects canonical ISO date bounds', () => {
  assert.equal(isDateWithinBounds('2025-03-21', '2025-03-01', '2025-03-31'), true);
  assert.equal(isDateWithinBounds('2025-02-28', '2025-03-01', '2025-03-31'), false);
  assert.equal(isDateWithinBounds('2025-03-32'), false);
});
