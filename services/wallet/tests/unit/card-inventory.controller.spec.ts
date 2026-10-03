import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CardInventoryController } from '../../src/interfaces/http/card-inventory.controller.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const headers = {
  'x-funtino-actor-user-id': '44444444-4444-4444-8444-444444444444',
  'x-correlation-id': '55555555-5555-4555-8555-555555555555',
  'idempotency-key': '66666666-6666-4666-8666-666666666666',
};

test('If-Match accepts only a positive safe-integer version string', async () => {
  let received: unknown;
  const controller = new CardInventoryController({
    changeStatus: async (command: unknown) => {
      received = command;
      return command;
    },
  } as never);

  await controller.changeStatus(
    organizationId,
    branchId,
    cardId,
    '12',
    { status: 'blocked', reason: 'Reported as lost' },
    headers,
  );
  assert.equal((received as { expectedVersion: number }).expectedVersion, 12);

  for (const invalid of ['0', '-1', '01', '1e3', '"12', '9007199254740993', ['12']]) {
    assert.throws(
      () =>
        controller.changeStatus(
          organizationId,
          branchId,
          cardId,
          invalid,
          { status: 'blocked', reason: 'Reported as lost' },
          headers,
        ),
      BadRequestException,
    );
  }
});
