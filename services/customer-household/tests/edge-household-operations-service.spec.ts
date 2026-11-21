import assert from 'node:assert/strict';
import test from 'node:test';
import { EdgeHouseholdOperationsService } from '../src/application/edge-household-operations.service.js';

const sourceInstanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const branchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const customerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const householdId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

test('Edge customer search can find an active household before its first branch card is assigned', async () => {
  let profileQuery: unknown;
  let householdQuery: unknown;
  let auditInput: unknown;
  const service = new EdgeHouseholdOperationsService(
    {
      customerProfile: {
        findMany: async (query: unknown) => {
          profileQuery = query;
          return [{ userId: customerId, firstName: 'آرمان', lastName: 'نمونه', version: 3 }];
        },
      },
      household: {
        findMany: async (query: unknown) => {
          householdQuery = query;
          return [{ id: householdId, ownerUserId: customerId, members: [] }];
        },
      },
      auditLog: {
        create: async (input: unknown) => {
          auditInput = input;
          return {};
        },
      },
    } as never,
    {} as never,
    {} as never,
  );

  const result = await service.searchCustomers({
    sourceInstanceId,
    branchId,
    actorUserId,
    correlationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    query: 'آرمان',
    pageSize: 25,
  });

  assert.deepEqual(result, {
    items: [
      {
        customerId,
        displayName: 'آرمان نمونه',
        maskedPhone: null,
        householdId,
        memberId: null,
        recordVersion: 3,
      },
    ],
    nextCursor: null,
  });
  assert.equal(JSON.stringify(profileQuery).includes('firstName'), true);
  assert.equal(JSON.stringify(householdQuery).includes(customerId), true);
  assert.equal(JSON.stringify(auditInput).includes(branchId), true);
  assert.equal(JSON.stringify(auditInput).includes('آرمان'), false);
});
