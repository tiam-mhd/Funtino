import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomerFamilySupportService } from '../application/customer/customer-family-support.service.js';
import type { CustomerHouseholdClient } from '../infrastructure/customer-household/customer-household.client.js';
import type { WalletClient } from '../infrastructure/wallet/wallet.client.js';
import type { FuntinoStorePort } from '../infrastructure/store/funtino-store.js';

const actorUserId = '45bffab0-e9fd-4d03-b05b-98099a726d9f';
const assignedHouseholdId = 'b43a113e-d5a1-4e61-b314-e6641c03d70c';
const outsideHouseholdId = 'c06c50bb-25e2-4b69-a9f7-707233d3cdd2';

test('support history is fetched only for households assigned to the selected branch', async () => {
  const historyReads: Array<[string, string]> = [];
  const households = {
    listFamilyForUser: async () => ({
      items: [
        {
          id: assignedHouseholdId,
          name: 'خانواده اول',
          members: [],
          invitations: [],
          relationships: [],
        },
        {
          id: outsideHouseholdId,
          name: 'خانواده دوم',
          members: [],
          invitations: [],
          relationships: [],
        },
      ],
    }),
    listFamilyAuditHistory: async (actorId: string, householdId: string) => {
      historyReads.push([actorId, householdId]);
      return [{ action: 'customer.family.member.created', createdAt: '2026-10-13T09:00:00.000Z' }];
    },
  } as unknown as CustomerHouseholdClient;
  const wallet = {
    listHouseholdAssignments: async (householdId: string) => [
      {
        status: 'assigned',
        organizationId: 'f9b2dce8-48cf-4e1a-bc6e-44d3e1eb4b00',
        branchId:
          householdId === assignedHouseholdId
            ? '146c8b85-f4e2-4a6e-a933-24ee04734f70'
            : '7ea8eac0-cd0c-46de-a2d4-01dc98e81c33',
      },
    ],
  } as unknown as WalletClient;
  const store = {
    consumeOperationsCustomerLookupQuota: async () => 1,
    recordAudit: async () => undefined,
    getUserByPhone: async () => ({ id: 'a012acb4-ab83-4bc5-9516-c125f8d30000' }),
  } as unknown as FuntinoStorePort;

  const service = new CustomerFamilySupportService(store, households, wallet);
  const result = await service.lookup({
    phone: '09123456789',
    organizationId: 'f9b2dce8-48cf-4e1a-bc6e-44d3e1eb4b00',
    branchId: '146c8b85-f4e2-4a6e-a933-24ee04734f70',
    actorUserId,
    correlationId: '70362658-4ac7-421b-aa9f-9547a938e9e8',
  });

  assert.deepEqual(historyReads, [[actorUserId, assignedHouseholdId]]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.householdId, assignedHouseholdId);
  assert.equal(result.items[0]?.history[0]?.action, 'customer.family.member.created');
});
