import assert from 'node:assert/strict';
import test from 'node:test';
import { hashSecret } from '@funtino/backend-core';
import { AuthService } from '../application/auth/auth.service.js';
import { CustomerService } from '../application/customer/customer.service.js';
import type { Session } from '../domain/models.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { CustomerHouseholdClient } from '../infrastructure/customer-household/customer-household.client.js';
import type { WalletClient } from '../infrastructure/wallet/wallet.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';
import { InMemoryFuntinoStore } from '../infrastructure/store/funtino-store.js';

process.env.NODE_ENV = 'test';
process.env.EXPOSE_DEV_OTP = 'true';

const adminUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const householdId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const memberId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const branchId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const cardId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function accessClient(systemAdmin = false): IdentityAccessClient {
  return {
    currentAccessContext: async () => ({
      memberships: systemAdmin
        ? [
            {
              membershipId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              status: 'active',
              scope: { type: 'global' },
              role: {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'system_admin',
                scope: { type: 'global' },
                permissionKeys: [],
                systemManaged: true,
                status: 'active',
                version: 1,
              },
              version: 1,
            },
          ]
        : [],
      policyVersion: 1,
      catalogVersion: 1,
      managementSessionTtlHours: 12,
    }),
  } as unknown as IdentityAccessClient;
}

test('customer OTP creates a non-admin session only after live IAM classification', async () => {
  const store = new InMemoryFuntinoStore();
  const auth = new AuthService(store, accessClient());
  const otp = await auth.requestOtp('09121234567');
  assert.ok(otp.devCode);

  const login = await auth.verifyOtp({
    challengeId: otp.challengeId,
    phone: '09121234567',
    code: otp.devCode,
  });
  assert.equal(login.mfaRequired, false);
  const session = store.findSession(hashSecret(login.token));
  assert.equal(session?.isSystemAdmin, false);
  assert.equal(session?.mfaLoginDeadlineAt, null);
});

test('global system administrators receive a five-minute MFA-pending session on every OTP login', async () => {
  const store = new InMemoryFuntinoStore();
  const auth = new AuthService(store, accessClient(true));
  const otp = await auth.requestOtp('09121234568');
  assert.ok(otp.devCode);

  const before = Date.now();
  const login = await auth.verifyOtp({
    challengeId: otp.challengeId,
    phone: '09121234568',
    code: otp.devCode,
  });
  const session = store.findSession(hashSecret(login.token));
  assert.equal(login.mfaRequired, true);
  assert.equal(session?.isSystemAdmin, true);
  assert.equal(session?.mfaVerifiedAt, null);
  assert.ok(session?.mfaLoginDeadlineAt && session.mfaLoginDeadlineAt >= before + 5 * 60_000 - 100);
});

test('IAM failure leaves the OTP unconsumed and does not create an unclassified session', async () => {
  const store = new InMemoryFuntinoStore();
  const auth = new AuthService(store, {
    currentAccessContext: async () => {
      throw new Error('IAM unavailable');
    },
  } as unknown as IdentityAccessClient);
  const otp = await auth.requestOtp('09121234569');
  assert.ok(otp.devCode);

  await assert.rejects(
    auth.verifyOtp({
      challengeId: otp.challengeId,
      phone: '09121234569',
      code: otp.devCode,
    }),
  );
  assert.equal(store.getOtpChallenge(otp.challengeId).consumedAt, null);
  assert.equal(store.findSession('no-session'), undefined);
});

test('MFA evidence remains session-local and activity timestamps are persisted', () => {
  const store = new InMemoryFuntinoStore();
  const session = store.saveSession(adminUserId, 'session-hash', 60_000, {
    isSystemAdmin: true,
    mfaLoginDeadlineAt: Date.now() + 5 * 60_000,
  });
  assert.equal(session.mfaVerifiedAt, null);
  assert.equal(session.isSystemAdmin, true);
  const activity = Date.now() + 1000;
  store.touchSessionActivity(session.id, activity);
  assert.equal(store.findSession('session-hash')?.lastActivityAt, activity);

  const verifiedAt = new Date().toISOString();
  store.updateSessionMfa(session.id, { verifiedAt, factorVersion: 2, method: 'totp' });
  assert.equal(store.findSession('session-hash')?.mfaVerifiedAt, Date.parse(verifiedAt));
  store.clearSessionMfa(session.id);
  assert.equal(store.findSession('session-hash')?.mfaVerifiedAt, null);
});

test('customer card presentation derives family/branch only from owner and Wallet assignment DTOs', async () => {
  const store = new InMemoryFuntinoStore();
  const household = {
    id: householdId,
    name: 'خانواده‌ی آزمایشی',
    status: 'active' as const,
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    members: [
      {
        id: memberId,
        householdId,
        displayName: 'آراد',
        relationship: 'child',
        birthDate: null,
        status: 'active' as const,
        isDependent: true,
        version: 1,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ],
  };
  const owner = {
    listHouseholdsForUser: async () => [household],
  } as unknown as CustomerHouseholdClient;
  const wallet = {
    listHouseholdAssignments: async () => [
      {
        id: '12121212-1212-4212-8212-121212121212',
        cardId,
        organizationId: '13131313-1313-4313-8313-131313131313',
        branchId,
        householdId,
        maskedIdentifier: '•••• 1234',
        status: 'assigned' as const,
        verificationStatus: 'verified' as const,
        assignedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
  } as unknown as WalletClient;
  const customer = new CustomerService(store, owner, wallet, {} as OrganizationBranchClient);
  const cards = await customer.listCards(adminUserId);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.householdId, householdId);
  assert.equal(cards[0]?.memberId, null);
  assert.equal(cards[0]?.branchId, branchId);
  assert.equal(cards[0]?.freshness, 'unknown');
  assert.equal(cards[0]?.walletId, null);
  assert.equal('externalCardId' in (cards[0] ?? {}), false);
});

test('wallet ledger application preserves append-only, idempotent behavior', () => {
  const store = new InMemoryFuntinoStore();
  const user = store.createUser('+989121234569');
  const household = store.createHousehold(
    { ownerUserId: user.id, name: 'کیف پول آزمایشی' },
    '99999999-9999-4999-8999-999999999999',
  );
  const wallet = store.ensureWallet(household.id);
  const first = store.applyWalletLedgerEntry({
    walletId: wallet.id,
    assetType: 'loyalty_points',
    kind: 'reward',
    amountMinor: 500,
    currency: wallet.currency,
    idempotencyKey: 'test-ledger-event-1',
    source: 'test',
    occurredAt: new Date().toISOString(),
    correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const duplicate = store.applyWalletLedgerEntry({
    walletId: wallet.id,
    assetType: 'loyalty_points',
    kind: 'reward',
    amountMinor: 500,
    currency: wallet.currency,
    idempotencyKey: 'test-ledger-event-1',
    source: 'test',
    occurredAt: new Date().toISOString(),
    correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(store.listLedgerEntries(wallet.id).length, 1);
});
