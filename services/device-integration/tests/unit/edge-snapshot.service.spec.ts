import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { EdgeSnapshotService } from '../../src/application/edge-snapshot.service.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';
import type { DeviceSignatureVerifier } from '../../src/application/ports/device-signature-verifier.port.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const sourceInstanceId = '33333333-3333-4333-8333-333333333333';
const cardId = '44444444-4444-4444-8444-444444444444';
const householdId = '55555555-5555-4555-8555-555555555555';
const keyId = 'edge-test-key-v1';
const signingSecret = Buffer.from('test-only-edge-snapshot-signing-key');

function uuidAt(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function makeVerifier(): DeviceSignatureVerifier {
  const sign = (body: Buffer, suppliedKeyId: string | undefined) => {
    if (suppliedKeyId !== keyId) return null;
    return `sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}`;
  };
  return {
    isConfigured: () => true,
    verify: () => true,
    isEdgeConfigured: () => true,
    signEdge: sign,
    verifyEdge: (body, suppliedKeyId, signature) => sign(body, suppliedKeyId) === signature,
  };
}

function createHarness() {
  const devices = Array.from({ length: 105 }, (_, index) => ({
    id: uuidAt(index + 1),
    organizationId,
    branchId,
    displayName: `Reader ${index + 1}`,
    deviceType: 'rfid_reader',
    version: index + 1,
  }));
  let storedSnapshot: Record<string, unknown> | undefined;
  let createCount = 0;
  const prisma = {
    edgeInstallation: { updateMany: async () => ({ count: 1 }) },
    edgeSnapshot: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCount += 1;
        storedSnapshot = data;
        return { ...data, createdAt: data.validFrom };
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        storedSnapshot?.id === where.id
          ? { ...storedSnapshot, createdAt: storedSnapshot.validFrom }
          : null,
    },
  };
  const deviceRegistry = {
    getEdgeInstallation: async () => ({
      sourceInstanceId,
      organizationId,
      branchId,
      status: 'active',
    }),
    listDevices: async ({ cursor }: { cursor?: string }) => {
      const start = cursor ? devices.findIndex((device) => device.id === cursor) + 1 : 0;
      const items = devices.slice(start, start + 100);
      return {
        items,
        nextCursor: start + items.length < devices.length ? (items.at(-1)?.id ?? null) : null,
      };
    },
  };
  const walletMappings = {
    listMappings: async () => [
      {
        cardId,
        cardUidHash: 'a'.repeat(64),
        householdId,
        memberId: null,
      },
    ],
  };
  const pricing = {
    getBranchSnapshot: async () => ({
      status: 'disabled',
      version: null,
      reasonCode: 'PENDING_WINDOWS_GOLDEN_VECTORS',
    }),
  };
  const verifier = makeVerifier();
  return {
    service: new EdgeSnapshotService(
      prisma as unknown as PrismaService,
      deviceRegistry as never,
      walletMappings as never,
      pricing as never,
      verifier,
    ),
    getCreateCount: () => createCount,
    verifyPage: (page: Record<string, unknown>) => {
      const { signature, ...signed } = page;
      return verifier.verifyEdge(
        Buffer.from(stableStringify(signed), 'utf8'),
        keyId,
        String(signature),
      );
    },
  };
}

test('Edge snapshot pages are immutable, branch-scoped, signed, and resume from a signed cursor', async () => {
  const harness = createHarness();
  const first = await harness.service.getPage({ sourceInstanceId, branchId, keyId });

  assert.equal(first.items.length, 100);
  assert.ok(first.nextCursor);
  assert.equal(harness.verifyPage(first as unknown as Record<string, unknown>), true);
  assert.equal(first.pricing.status, 'disabled');
  assert.deepEqual(first.pricing.rules, []);
  assert.deepEqual(first.attractions, []);
  assert.deepEqual(first.settings, []);
  assert.equal(harness.getCreateCount(), 1);

  await assert.rejects(
    harness.service.getPage({
      sourceInstanceId,
      branchId,
      keyId: 'rotated-key',
      cursor: first.nextCursor!,
    }),
    UnauthorizedException,
  );
  const second = await harness.service.getPage({
    sourceInstanceId,
    branchId,
    keyId,
    cursor: first.nextCursor!,
  });

  assert.equal(second.items.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(second.snapshotId, first.snapshotId);
  assert.equal(second.snapshotVersion, first.snapshotVersion);
  assert.equal(second.documentHash, first.documentHash);
  assert.equal(harness.verifyPage(second as unknown as Record<string, unknown>), true);
  assert.equal(harness.getCreateCount(), 1);
  const mappings = second.items.filter((item) => item.kind === 'card_mapping');
  assert.deepEqual(mappings, [
    {
      kind: 'card_mapping',
      value: { cardId, cardUidHash: 'a'.repeat(64), householdId, memberId: null },
    },
  ]);
});

test('Edge snapshot rejects a branch different from the registered installation', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.service.getPage({ sourceInstanceId, branchId: randomUUID(), keyId }),
    UnauthorizedException,
  );
  assert.equal(harness.getCreateCount(), 0);
});
