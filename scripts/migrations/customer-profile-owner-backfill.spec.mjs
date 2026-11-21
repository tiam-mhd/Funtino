import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfilePlan } from './customer-profile-owner-backfill.mjs';

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';

function source(id, firstName, email = null) {
  return {
    id,
    firstName,
    lastName: null,
    email,
    birthDate: null,
    gender: null,
    city: null,
    avatarPreset: null,
    profileCompletedAt: null,
    avatar: null,
  };
}

test('customer profile backfill plans inserts, exact duplicates, conflicting owners, and unmapped IDs', () => {
  const result = buildProfilePlan(
    [
      source(userA, 'Mina'),
      source(userA, 'Mina'),
      source(userA, 'Other'),
      source('invalid', 'Unknown'),
      source(userB, 'Sara'),
    ],
    [{ userId: userA, ...resultProfile(source(userA, 'Mina')) }],
  );
  assert.deepEqual(result.counts, {
    read: 5,
    imported: 1,
    duplicates: 2,
    unmapped: 1,
    rejected: 1,
  });
  assert.deepEqual(result.rejectedCodes, { SOURCE_PROFILE_CONFLICT: 1 });
  assert.equal(result.plan[0]?.userId, userB);
  assert.match(result.checksum, /^[a-f0-9]{64}$/u);
});

test('customer profile backfill rejects email ownership conflicts without exposing values in its report', () => {
  const result = buildProfilePlan(
    [source(userB, 'Sara', 'same@example.test')],
    [{ userId: userA, ...resultProfile(source(userA, 'Mina', 'same@example.test')) }],
  );
  assert.deepEqual(result.counts, {
    read: 1,
    imported: 0,
    duplicates: 0,
    unmapped: 0,
    rejected: 1,
  });
  assert.deepEqual(result.rejectedCodes, { EMAIL_IN_USE: 1 });
  assert.equal(
    JSON.stringify({
      counts: result.counts,
      rejectedCodes: result.rejectedCodes,
      checksum: result.checksum,
    }).includes('same@example.test'),
    false,
  );
});

function resultProfile(value) {
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    email: value.email,
    birthDate: value.birthDate,
    gender: value.gender,
    city: value.city,
    avatarPreset: value.avatarPreset,
    avatarData: null,
    avatarMimeType: null,
    avatarUpdatedAt: null,
    profileCompletedAt: value.profileCompletedAt,
  };
}
