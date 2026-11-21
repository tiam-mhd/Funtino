import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { EdgeProvisionalCustomerService } from '../src/application/edge-provisional-customer.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const input = {
  provisionalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  branchId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  actorUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  correlationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};

type IdempotencyData = { key: string; requestHash: string; response: unknown };
type IdempotencyQuery = { where: { callerService_key: { callerService: string; key: string } } };
type ProvisionalRow = {
  id: string;
  provisionalId: string;
  sourceInstanceId: string;
  branchId: string;
  createdByUserId: string;
  status: 'pending_review';
  createdAt: Date;
};

function makeService() {
  const commands = new Map<string, IdempotencyData>();
  const records = new Map<string, ProvisionalRow>();
  const writes = { records: 0, audits: 0, outbox: 0 };
  const tx = {
    idempotencyCommand: {
      findUnique: async ({ where }: IdempotencyQuery) =>
        commands.get(where.callerService_key.key) ?? null,
      create: async ({ data }: { data: IdempotencyData }) => {
        commands.set(data.key, data);
        return data;
      },
    },
    provisionalCustomer: {
      findUnique: async ({
        where,
      }: {
        where: {
          sourceInstanceId_provisionalId: { sourceInstanceId: string; provisionalId: string };
        };
      }) =>
        records.get(
          `${where.sourceInstanceId_provisionalId.sourceInstanceId}/${where.sourceInstanceId_provisionalId.provisionalId}`,
        ) ?? null,
      create: async ({ data }: { data: Omit<ProvisionalRow, 'createdAt'> }) => {
        writes.records += 1;
        const row: ProvisionalRow = {
          ...data,
          createdAt: new Date('2026-11-21T00:00:00.000Z'),
        };
        records.set(`${data.sourceInstanceId}/${data.provisionalId}`, row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.audits += 1;
        return data;
      },
    },
    outboxEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.outbox += 1;
        return data;
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
    idempotencyCommand: {
      findUnique: async ({ where }: IdempotencyQuery) =>
        commands.get(where.callerService_key.key) ?? null,
    },
  } as unknown as PrismaService;
  return { service: new EdgeProvisionalCustomerService(prisma), writes };
}

test('temporary Edge customer is a pending identifier with no profile data and one outbox event', async () => {
  const { service, writes } = makeService();
  const first = await service.create(input);
  const replay = await service.create(input);

  assert.deepEqual(replay, first);
  assert.equal(first.status, 'pending_review');
  assert.equal('name' in first, false);
  assert.equal('phone' in first, false);
  assert.deepEqual(writes, { records: 1, audits: 1, outbox: 1 });
});

test('an idempotency key cannot be reused for another branch or provisional customer', async () => {
  const { service } = makeService();
  await service.create(input);
  await assert.rejects(
    service.create({ ...input, branchId: '12121212-1212-4121-8121-121212121212' }),
    (error: unknown) => error instanceof ConflictException,
  );
});

test('the same source installation and provisional ID are not duplicated under a new retry key', async () => {
  const { service, writes } = makeService();
  const first = await service.create(input);
  const retry = await service.create({
    ...input,
    idempotencyKey: '10101010-1010-4010-8010-101010101010',
  });
  assert.deepEqual(retry, first);
  assert.deepEqual(writes, { records: 1, audits: 1, outbox: 1 });
});
