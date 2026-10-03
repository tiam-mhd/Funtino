import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { CardInventoryService } from '../../src/application/card-inventory.service.js';
import type { BranchScopeValidator } from '../../src/application/ports/branch-scope-validator.port.js';
import type { HouseholdValidator } from '../../src/application/ports/household-validator.port.js';
import type { CardInventoryRepository } from '../../src/application/ports/card-inventory.repository.js';
import type {
  CardAssignmentView,
  CardInventoryView,
} from '../../src/domain/card-inventory/card-inventory.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const correlationId = '66666666-6666-4666-8666-666666666666';
const assignmentId = '77777777-7777-4777-8777-777777777777';
const householdId = '88888888-8888-4888-8888-888888888888';
const meta = { callerService: 'api-gateway' as const, actorUserId, idempotencyKey, correlationId };

function card(status: CardInventoryView['status'], version = 1): CardInventoryView {
  return {
    id: cardId,
    organizationId,
    branchId,
    maskedIdentifier: '•••• 4821',
    status,
    verificationStatus: 'unknown',
    version,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function assignment(): CardAssignmentView {
  return {
    id: assignmentId,
    cardId,
    organizationId,
    branchId,
    householdId,
    maskedIdentifier: '•••• 4821',
    status: 'assigned',
    verificationStatus: 'verified',
    assignedAt: '2026-10-01T00:00:00.000Z',
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const calls: { branch?: unknown[]; register?: unknown[]; change?: unknown[] } = {};
  const repository = {
    findIdempotentMutation: async () => null,
    registerCard: async (...args: unknown[]) => {
      calls.register = args;
      return card('in_stock');
    },
    changeCardStatus: async (...args: unknown[]) => {
      calls.change = args;
      return card((args[0] as { status: CardInventoryView['status'] }).status, 2);
    },
    listCards: async () => ({ items: [], nextCursor: null }),
    getCard: async () => card('in_stock'),
    isReady: async () => {},
    ...overrides,
  } as unknown as CardInventoryRepository;
  const branchScope = {
    assertActiveBranch: async (...args: unknown[]) => {
      calls.branch = args;
    },
  } as BranchScopeValidator;
  const householdValidator = { assertActiveHousehold: async () => {} } as HouseholdValidator;
  return { service: new CardInventoryService(repository, branchScope, householdValidator), calls };
}

test('registration normalizes the identifier, validates branch ownership, and returns no raw identifier', async () => {
  const { service, calls } = setup();
  const result = await service.registerCard(
    organizationId,
    branchId,
    { externalCardId: ' CARD-4821 ', reason: 'Initial inventory receipt' },
    meta,
  );
  assert.deepEqual(calls.branch, [organizationId, branchId]);
  assert.equal((calls.register?.[0] as { externalCardId: string }).externalCardId, 'CARD-4821');
  assert.equal(result.maskedIdentifier, '•••• 4821');
  assert.equal('externalCardId' in result, false);
});

test('registration replays a committed command without rechecking branch or writing a second card', async () => {
  const expected = card('in_stock');
  const repository = {
    findIdempotentMutation: async () => expected,
    registerCard: async () => assert.fail('replayed command must not write'),
  };
  const branchScope = {
    assertActiveBranch: async () =>
      assert.fail('replay must not require current branch availability'),
  } as BranchScopeValidator;
  const service = new CardInventoryService(
    repository as unknown as CardInventoryRepository,
    branchScope,
    { assertActiveHousehold: async () => {} },
  );
  assert.deepEqual(
    await service.registerCard(
      organizationId,
      branchId,
      { externalCardId: 'CARD-4821', reason: 'Initial inventory receipt' },
      meta,
    ),
    expected,
  );
});

test('registration fails closed when the branch owner rejects the branch', async () => {
  const repository = {
    findIdempotentMutation: async () => null,
    registerCard: async () => assert.fail('unvalidated branch must not be written'),
  };
  const branchScope = {
    assertActiveBranch: async () => {
      throw new ConflictException('branch unavailable');
    },
  } as BranchScopeValidator;
  const service = new CardInventoryService(
    repository as unknown as CardInventoryRepository,
    branchScope,
    { assertActiveHousehold: async () => {} },
  );
  await assert.rejects(
    () =>
      service.registerCard(
        organizationId,
        branchId,
        { externalCardId: 'CARD-4821', reason: 'Initial inventory receipt' },
        meta,
      ),
    ConflictException,
  );
});

test('stale versions and terminal lifecycle transitions are rejected', async () => {
  const stale = setup({ getCard: async () => card('in_stock', 2) });
  await assert.rejects(
    () =>
      stale.service.changeStatus(
        {
          organizationId,
          branchId,
          cardId,
          expectedVersion: 1,
          status: 'blocked',
          reason: 'Reported as lost',
        },
        meta,
      ),
    ConflictException,
  );
  assert.equal(stale.calls.change, undefined);

  const retired = setup({ getCard: async () => card('retired', 3) });
  await assert.rejects(
    () =>
      retired.service.changeStatus(
        {
          organizationId,
          branchId,
          cardId,
          expectedVersion: 3,
          status: 'in_stock',
          reason: 'Return to shelf',
        },
        meta,
      ),
    ConflictException,
  );
  assert.equal(retired.calls.change, undefined);
});

test('unblocking a card requires the current branch to be active', async () => {
  const { service, calls } = setup({ getCard: async () => card('blocked', 2) });
  await service.changeStatus(
    {
      organizationId,
      branchId,
      cardId,
      expectedVersion: 2,
      status: 'in_stock',
      reason: 'Inspection completed',
    },
    meta,
  );
  assert.deepEqual(calls.branch, [organizationId, branchId]);
  assert.ok(calls.change);
});

test('transfer validates requested tenant scope before mutating and forwards the fixed branch', async () => {
  let received: unknown;
  let branchCall: unknown[] | undefined;
  const service = new CardInventoryService(
    {
      findIdempotentMutation: async () => null,
      getAssignment: async () => assignment(),
      transferAssignment: async (command: unknown) => {
        received = command;
        return assignment();
      },
    } as never,
    {
      assertActiveBranch: async (...args: unknown[]) => {
        branchCall = args;
      },
    } as never,
    { assertActiveHousehold: async () => {} } as never,
  );
  const targetHouseholdId = '99999999-9999-4999-8999-999999999999';
  await service.transferAssignment(
    {
      organizationId,
      branchId,
      assignmentId,
      householdId: targetHouseholdId,
      reason: 'Household requested branch transfer',
    },
    meta,
  );
  assert.deepEqual(branchCall, [organizationId, branchId]);
  assert.deepEqual(received, {
    organizationId,
    branchId,
    assignmentId,
    householdId: targetHouseholdId,
    reason: 'Household requested branch transfer',
  });
});

test('cancellation replays a committed idempotent result without requiring the deleted assignment', async () => {
  const expected = { assignmentId, status: 'cancelled' as const };
  const service = new CardInventoryService(
    {
      findIdempotentMutation: async () => expected,
      getAssignment: async () => assert.fail('replay must not read a deleted active allocation'),
      cancelAssignment: async () => assert.fail('replay must not write a second cancellation'),
    } as never,
    {
      assertActiveBranch: async () =>
        assert.fail('replay must not depend on current owner availability'),
    } as never,
    { assertActiveHousehold: async () => {} } as never,
  );
  assert.deepEqual(
    await service.cancelAssignment(
      {
        organizationId,
        branchId,
        assignmentId,
        reason: 'Household returned this card',
      },
      meta,
    ),
    expected,
  );
});
