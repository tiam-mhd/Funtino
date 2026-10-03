import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isHouseholdEligibleForCard,
  normalizeHouseholdName,
  normalizeMemberText,
} from '../src/domain/household/household.js';

test('only active households are eligible for card assignment', () => {
  assert.equal(isHouseholdEligibleForCard('active'), true);
  assert.equal(isHouseholdEligibleForCard('suspended'), false);
  assert.equal(isHouseholdEligibleForCard('archived'), false);
});

test('household names normalize Unicode and whitespace without accepting controls', () => {
  assert.equal(normalizeHouseholdName('  خانواده   آفتاب  '), 'خانواده آفتاب');
  assert.throws(() => normalizeHouseholdName('x'));
  assert.throws(() => normalizeHouseholdName('خانه\nنو'));
});

test('member labels have bounded normalized values', () => {
  assert.equal(normalizeMemberText('  پدر  ', 40), 'پدر');
  assert.throws(() => normalizeMemberText(' ', 40));
});
