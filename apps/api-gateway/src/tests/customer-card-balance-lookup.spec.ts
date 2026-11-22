import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import { CustomerService } from '../application/customer/customer.service.js';
import type { CustomerHouseholdClient } from '../infrastructure/customer-household/customer-household.client.js';
import type { DeviceIntegrationClient } from '../infrastructure/device-integration/device-integration.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';
import type { FuntinoStorePort } from '../infrastructure/store/funtino-store.js';
import type { WalletClient } from '../infrastructure/wallet/wallet.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const householdId = '22222222-2222-4222-8222-222222222222';
const secondHouseholdId = '33333333-3333-4333-8333-333333333333';
const cardUidHash = '34b8d380d481b933d5238d945a16ee6c0be176960926735bce473b829e4bd517';

function createService(input: {
  quota?: number;
  households?: Array<{ id: string }>;
  lookup?: (value: unknown) => Promise<unknown>;
}) {
  let quotaInput: unknown;
  let householdReadCount = 0;
  let walletInput: unknown;
  const service = new CustomerService(
    {
      consumeOperationsCustomerLookupQuota: async (value: {
        actorUserId: string;
        branchId: string;
        windowStartedAt: number;
        maxRequests: number;
      }) => {
        quotaInput = value;
        return input.quota ?? 1;
      },
    } as unknown as FuntinoStorePort,
    {
      listHouseholdsForUser: async (id: string) => {
        householdReadCount += 1;
        assert.equal(id, userId);
        return (input.households ?? [{ id: householdId }]) as never;
      },
    } as unknown as CustomerHouseholdClient,
    {
      lookupCardBalanceByHash: async (value: unknown) => {
        walletInput = value;
        return input.lookup ? input.lookup(value) : { status: 'available', balanceRial: 125_000 };
      },
    } as unknown as WalletClient,
    {} as OrganizationBranchClient,
    {} as DeviceIntegrationClient,
  );
  return {
    service,
    get quotaInput() {
      return quotaInput as Record<string, unknown> | undefined;
    },
    get householdReadCount() {
      return householdReadCount;
    },
    get walletInput() {
      return walletInput as Record<string, unknown> | undefined;
    },
  };
}

test('customer lookup uses CurrentUser households and returns only the Wallet result', async () => {
  const harness = createService({ households: [{ id: householdId }, { id: secondHouseholdId }] });
  const result = await harness.service.lookupCardBalance(userId, cardUidHash);

  assert.deepEqual(result, { status: 'available', balanceRial: 125_000 });
  assert.equal(harness.quotaInput?.actorUserId, userId);
  assert.equal(harness.quotaInput?.maxRequests, 10);
  assert.deepEqual(harness.walletInput, {
    cardUidHash,
    audience: { type: 'customer', householdIds: [householdId, secondHouseholdId] },
  });
  assert.equal('userId' in (harness.walletInput ?? {}), false);
});

test('customer rate limit blocks household and Wallet lookups', async () => {
  const harness = createService({ quota: 11 });
  await assert.rejects(
    harness.service.lookupCardBalance(userId, cardUidHash),
    (error: unknown) => error instanceof DomainError && error.code === 'RATE_LIMITED',
  );
  assert.equal(harness.householdReadCount, 0);
  assert.equal(harness.walletInput, undefined);
});

test('customer with no authorized household receives the generic unavailable result', async () => {
  const harness = createService({ households: [] });
  assert.deepEqual(await harness.service.lookupCardBalance(userId, cardUidHash), {
    status: 'unavailable',
  });
  assert.equal(harness.walletInput, undefined);
});
