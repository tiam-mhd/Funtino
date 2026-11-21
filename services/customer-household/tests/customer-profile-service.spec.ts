import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { CustomerProfileService } from '../src/application/customer-profile.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const userId = '10000000-0000-4000-8000-000000000001';
const correlationId = '10000000-0000-4000-8000-000000000002';
const idempotencyKey = '10000000-0000-4000-8000-000000000003';

function fixture() {
  let current = {
    userId,
    firstName: null as string | null,
    lastName: null as string | null,
    email: null as string | null,
    birthDate: null as Date | null,
    gender: null as string | null,
    city: null as string | null,
    avatarPreset: null as string | null,
    avatarData: null as Uint8Array | null,
    avatarMimeType: null as string | null,
    avatarUpdatedAt: null as Date | null,
    profileCompletedAt: null as Date | null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  let command: { requestHash: string; response: unknown } | null = null;
  const audits: Array<Record<string, unknown>> = [];
  let updateCount = 0;
  const tx = {
    idempotencyCommand: {
      findUnique: async () => command,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        command = { requestHash: String(data.requestHash), response: data.response };
      },
    },
    customerProfile: {
      upsert: async () => current,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateCount += 1;
        const version = data.version as { increment: number } | undefined;
        current = {
          ...current,
          ...data,
          ...(version ? { version: current.version + version.increment } : {}),
        } as typeof current;
        return current;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => audits.push(data),
    },
  };
  const prisma = {
    $transaction: async (callback: (value: unknown) => unknown) => callback(tx),
  } as unknown as PrismaService;
  return { service: new CustomerProfileService(prisma), audits, getUpdateCount: () => updateCount };
}

test('profile mutations are versioned, idempotent, and audit metadata without profile values', async () => {
  const value = fixture();
  const meta = { expectedVersion: 1, idempotencyKey, correlationId };
  const saved = (await value.service.update(
    userId,
    { firstName: 'مینا', email: 'mina@example.test' },
    meta,
  )) as unknown as { version: number; firstName: string | null };
  assert.equal(saved.version, 2);
  assert.equal(saved.firstName, 'مینا');
  assert.equal(value.audits.length, 1);
  assert.deepEqual(value.audits[0]?.after, {
    version: 2,
    profileCompleted: false,
    changedFields: ['email', 'firstName'],
  });
  assert.equal(JSON.stringify(value.audits[0]).includes('mina@example.test'), false);

  const replay = await value.service.update(
    userId,
    { firstName: 'مینا', email: 'mina@example.test' },
    meta,
  );
  assert.deepEqual(replay, saved);
  assert.equal(value.getUpdateCount(), 2);
  assert.equal(value.audits.length, 1);
});

test('stale profile versions conflict instead of overwriting the current profile', async () => {
  const value = fixture();
  await assert.rejects(
    value.service.update(
      userId,
      { city: 'تهران' },
      { expectedVersion: 2, idempotencyKey, correlationId },
    ),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(value.audits.length, 0);
});

test('uploaded avatars must match an approved image signature and size bound', async () => {
  const value = fixture();
  await assert.rejects(
    value.service.saveAvatar(
      userId,
      { mimeType: 'image/png', dataBase64: Buffer.from('not-a-png').toString('base64') },
      { expectedVersion: 1, idempotencyKey, correlationId },
    ),
    (error: unknown) => error instanceof ConflictException,
  );
});
