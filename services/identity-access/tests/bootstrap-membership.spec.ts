import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOTSTRAP_MEMBERSHIP_TTL_MS,
  isBootstrapMembershipExpired,
  isEffectiveActiveMembership,
  SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
} from '../src/domain/authorization/bootstrap-membership.js';

test('temporary bootstrap access expires exactly at the 24-hour boundary', () => {
  const createdAt = new Date('2026-10-01T10:00:00.000Z');
  assert.equal(BOOTSTRAP_MEMBERSHIP_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    isBootstrapMembershipExpired(
      SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
      createdAt,
      new Date(createdAt.getTime() + BOOTSTRAP_MEMBERSHIP_TTL_MS - 1),
    ),
    false,
  );
  assert.equal(
    isBootstrapMembershipExpired(
      SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
      createdAt,
      new Date(createdAt.getTime() + BOOTSTRAP_MEMBERSHIP_TTL_MS),
    ),
    true,
  );
});

test('expired bootstrap membership is neither an active authorization context nor MFA-eligible staff', () => {
  const createdAt = new Date('2026-10-01T10:00:00.000Z');
  const afterExpiry = new Date(createdAt.getTime() + BOOTSTRAP_MEMBERSHIP_TTL_MS);
  assert.equal(
    isEffectiveActiveMembership(
      {
        status: 'active',
        createdAt,
        roleName: SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
      },
      afterExpiry,
    ),
    false,
  );
  assert.equal(
    isEffectiveActiveMembership(
      {
        status: 'active',
        createdAt,
        roleName: 'system_admin',
      },
      afterExpiry,
    ),
    true,
  );
  assert.equal(
    isEffectiveActiveMembership(
      {
        status: 'suspended',
        createdAt,
        roleName: 'system_admin',
      },
      afterExpiry,
    ),
    false,
  );
});
