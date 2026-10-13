import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import {
  CustomerHouseholdService,
  type HouseholdCommandMeta,
} from '../src/application/customer-household.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const actorUserId = '10000000-0000-4000-8000-000000000001';
const householdId = '10000000-0000-4000-8000-000000000002';
const viewerMemberId = '10000000-0000-4000-8000-000000000003';
const linkedRelativeId = '10000000-0000-4000-8000-000000000004';
const linkedAdultUserId = '10000000-0000-4000-8000-000000000005';
const phoneHash = 'a'.repeat(64);

function commandMeta(idempotencyKey: string): HouseholdCommandMeta {
  return {
    actorUserId,
    correlationId: '10000000-0000-4000-8000-000000000006',
    idempotencyKey,
    callerService: 'api-gateway',
  };
}

test('unregistered adult invitation persists only a token hash and never replays the bearer token', async () => {
  const idempotencyRows = new Map<string, { requestHash: string; response: unknown }>();
  const invitationRows: Array<Record<string, unknown>> = [];
  const memberRows: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];
  const outboxRows: Array<Record<string, unknown>> = [];
  const rowKey = (callerService: string, key: string) => `${callerService}:${key}`;

  const prisma = {
    idempotencyCommand: {
      findUnique: async ({
        where,
      }: {
        where: { callerService_key: { callerService: string; key: string } };
      }) =>
        idempotencyRows.get(
          rowKey(where.callerService_key.callerService, where.callerService_key.key),
        ) ?? null,
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        idempotencyCommand: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            idempotencyRows.set(rowKey(String(data.callerService), String(data.key)), {
              requestHash: String(data.requestHash),
              response: data.response,
            });
          },
          update: async ({
            where,
            data,
          }: {
            where: { callerService_key: { callerService: string; key: string } };
            data: { response: unknown };
          }) => {
            const key = rowKey(where.callerService_key.callerService, where.callerService_key.key);
            const row = idempotencyRows.get(key);
            assert.ok(row);
            idempotencyRows.set(key, { ...row, response: data.response });
          },
        },
        householdAccess: { findFirst: async () => ({ role: 'owner' }) },
        householdInvitation: {
          findFirst: async () => null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            invitationRows.push(data);
            return data;
          },
        },
        householdMember: {
          findFirst: async () => ({
            id: viewerMemberId,
            familyPerson: { accountUserId: actorUserId },
          }),
          create: async ({ data }: { data: Record<string, unknown> }) => {
            memberRows.push(data);
            return data;
          },
        },
        familyPerson: { create: async ({ data }: { data: Record<string, unknown> }) => data },
        householdRelationship: { findMany: async () => [], create: async () => undefined },
        auditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => auditRows.push(data),
        },
        outboxEvent: {
          create: async ({ data }: { data: Record<string, unknown> }) => outboxRows.push(data),
        },
      };
      return work(tx);
    },
  } as unknown as PrismaService;

  const service = new CustomerHouseholdService(prisma);
  const meta = commandMeta('10000000-0000-4000-8000-000000000007');
  const input = {
    displayName: 'مینا',
    relationship: 'sibling' as const,
    basis: 'unspecified' as const,
    isDependent: false,
    targetPhoneHash: phoneHash,
  };

  const first = await service.addFamilyMember(householdId, input, meta);
  const shareToken = first.invitation?.shareToken;
  assert.ok(shareToken);
  assert.match(shareToken, /^[A-Za-z0-9_-]{40,128}$/u);
  assert.equal(invitationRows[0]?.tokenHash, createHash('sha256').update(shareToken).digest('hex'));
  assert.equal(invitationRows[0]?.targetPhoneHash, phoneHash);
  assert.equal(memberRows.length, 1);
  assert.equal(invitationRows.length, 1);
  assert.equal(auditRows.length, 1);
  assert.equal(outboxRows.length, 1);

  const persistedResponse = JSON.stringify([...idempotencyRows.values()]);
  assert.doesNotMatch(persistedResponse, new RegExp(shareToken, 'u'));
  assert.doesNotMatch(JSON.stringify(outboxRows), new RegExp(shareToken, 'u'));
  assert.doesNotMatch(JSON.stringify(outboxRows), new RegExp(phoneHash, 'u'));

  const replay = await service.addFamilyMember(householdId, input, meta);
  assert.equal(replay.invitation?.shareToken, undefined);
  assert.equal(memberRows.length, 1);
  assert.equal(invitationRows.length, 1);
  assert.equal(auditRows.length, 1);
  assert.equal(outboxRows.length, 1);
});

test('family member creation rejects a relationship with another linked adult without writing data', async () => {
  const prisma = {
    idempotencyCommand: { findUnique: async () => null },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      let wroteMember = false;
      const tx = {
        idempotencyCommand: { create: async () => undefined, update: async () => undefined },
        householdAccess: { findFirst: async () => ({ role: 'owner' }) },
        householdMember: {
          findFirst: async () => ({
            id: linkedRelativeId,
            familyPerson: { accountUserId: linkedAdultUserId },
          }),
          create: async () => {
            wroteMember = true;
          },
        },
        familyPerson: { create: async () => undefined },
      };
      try {
        return await work(tx);
      } catch (error) {
        assert.equal(wroteMember, false);
        throw error;
      }
    },
  } as unknown as PrismaService;
  const service = new CustomerHouseholdService(prisma);

  await assert.rejects(
    service.addFamilyMember(
      householdId,
      {
        displayName: 'آوا',
        relativeMemberId: linkedRelativeId,
        relationship: 'child',
        basis: 'biological',
        isDependent: true,
      },
      commandMeta('10000000-0000-4000-8000-000000000008'),
    ),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('adult account invitations cannot be built against another member instead of the inviter', async () => {
  const prisma = {
    idempotencyCommand: { findUnique: async () => null },
    $transaction: async () => {
      throw new Error('Transaction should not start for an invalid adult invitation target.');
    },
  } as unknown as PrismaService;
  const service = new CustomerHouseholdService(prisma);

  await assert.rejects(
    service.addFamilyMember(
      householdId,
      {
        displayName: 'آوا',
        relativeMemberId: linkedRelativeId,
        relationship: 'sibling',
        basis: 'unspecified',
        isDependent: false,
        targetPhoneHash: phoneHash,
      },
      commandMeta('10000000-0000-4000-8000-000000000009'),
    ),
    (error: unknown) =>
      error instanceof Error && error.message.includes('Adult account invitations'),
  );
});

test('registered adult acceptance links the account, activates the relationship, and replays safely', async () => {
  const invitationId = '10000000-0000-4000-8000-000000000010';
  const memberId = '10000000-0000-4000-8000-000000000011';
  const pendingPersonId = '10000000-0000-4000-8000-000000000012';
  const acceptingPersonId = '10000000-0000-4000-8000-000000000013';
  const createdAt = new Date('2026-10-13T08:00:00.000Z');
  const idempotencyRows = new Map<string, { requestHash: string; response: unknown }>();
  const auditRows: Array<Record<string, unknown>> = [];
  const outboxRows: Array<Record<string, unknown>> = [];
  const memberUpdates: Array<Record<string, unknown>> = [];
  const relationshipRows: Array<Record<string, unknown>> = [];
  const accessRows: Array<Record<string, unknown>> = [];
  const invitationState: {
    status: 'pending' | 'accepted' | 'linked';
    acceptedByUserId: string | null;
    acceptedAt: Date | null;
    memberStatus: 'pending' | 'active';
    familyPersonId: string;
  } = {
    status: 'pending',
    acceptedByUserId: null,
    acceptedAt: null,
    memberStatus: 'pending',
    familyPersonId: pendingPersonId,
  };
  const invitation = () => ({
    id: invitationId,
    householdId,
    memberId,
    relativeMemberId: viewerMemberId,
    kind: 'adult_account' as const,
    status: invitationState.status,
    relationshipKind: 'parent_of' as const,
    relationshipBasis: 'biological' as const,
    newMemberIsFrom: false,
    targetUserId: linkedAdultUserId,
    targetPhoneHash: null,
    tokenHash: 'b'.repeat(64),
    tokenKeyVersion: 'v1',
    createdByUserId: actorUserId,
    acceptedByUserId: invitationState.acceptedByUserId,
    claimUserId: null,
    expiresAt: null,
    acceptedAt: invitationState.acceptedAt,
    createdAt,
    updatedAt: createdAt,
    member: {
      id: memberId,
      householdId,
      familyPersonId: invitationState.familyPersonId,
      status: invitationState.memberStatus,
      isDependent: false,
      familyPerson: { accountUserId: null },
    },
  });
  const prisma = {
    idempotencyCommand: {
      findUnique: async ({
        where,
      }: {
        where: { callerService_key: { callerService: string; key: string } };
      }) =>
        idempotencyRows.get(
          `${where.callerService_key.callerService}:${where.callerService_key.key}`,
        ) ?? null,
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        idempotencyCommand: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            idempotencyRows.set(`${String(data.callerService)}:${String(data.key)}`, {
              requestHash: String(data.requestHash),
              response: data.response,
            });
          },
          update: async ({
            where,
            data,
          }: {
            where: { callerService_key: { callerService: string; key: string } };
            data: { response: unknown };
          }) => {
            const key = `${where.callerService_key.callerService}:${where.callerService_key.key}`;
            const row = idempotencyRows.get(key);
            assert.ok(row);
            idempotencyRows.set(key, { ...row, response: data.response });
          },
        },
        householdInvitation: {
          findFirst: async () => invitation(),
          updateMany: async ({
            where,
            data,
          }: {
            where: { status: 'pending' | 'accepted' };
            data: { status: 'accepted' | 'linked'; acceptedByUserId?: string; acceptedAt?: Date };
          }) => {
            if (invitationState.status !== where.status) return { count: 0 };
            invitationState.status = data.status;
            invitationState.acceptedByUserId =
              data.acceptedByUserId ?? invitationState.acceptedByUserId;
            invitationState.acceptedAt = data.acceptedAt ?? invitationState.acceptedAt;
            return { count: 1 };
          },
          findUniqueOrThrow: async () => invitation(),
        },
        household: { findFirst: async () => ({ id: householdId }) },
        householdMember: {
          findFirst: async ({ where }: { where: { id?: unknown } }) =>
            where.id === viewerMemberId
              ? { id: viewerMemberId, familyPerson: { accountUserId: actorUserId } }
              : null,
          findMany: async () => [{ id: viewerMemberId }],
          update: async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            memberUpdates.push({ where, data });
            invitationState.memberStatus = 'active';
            invitationState.familyPersonId = String(data.familyPersonId);
          },
        },
        householdRelationship: {
          findMany: async () => [],
          create: async ({ data }: { data: Record<string, unknown> }) =>
            relationshipRows.push(data),
        },
        familyPerson: {
          upsert: async () => ({ id: acceptingPersonId }),
          deleteMany: async () => undefined,
        },
        householdAccess: {
          upsert: async ({ create }: { create: Record<string, unknown> }) =>
            accessRows.push(create),
        },
        auditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => auditRows.push(data),
        },
        outboxEvent: {
          create: async ({ data }: { data: Record<string, unknown> }) => outboxRows.push(data),
        },
      };
      return work(tx);
    },
  } as unknown as PrismaService;
  const service = new CustomerHouseholdService(prisma);
  const meta = {
    ...commandMeta('10000000-0000-4000-8000-000000000014'),
    actorUserId: linkedAdultUserId,
  };
  const command = { invitationId };

  const accepted = await service.acceptInvitation(command, meta);
  assert.equal(accepted.status, 'linked');
  assert.equal(invitationState.status, 'linked');
  assert.equal(invitationState.memberStatus, 'active');
  assert.equal(invitationState.familyPersonId, acceptingPersonId);
  assert.equal(memberUpdates.length, 1);
  assert.equal(relationshipRows.length, 1);
  assert.deepEqual(
    {
      fromMemberId: relationshipRows[0]?.fromMemberId,
      toMemberId: relationshipRows[0]?.toMemberId,
    },
    { fromMemberId: viewerMemberId, toMemberId: memberId },
  );
  assert.equal(accessRows.length, 1);
  assert.equal(accessRows[0]?.userId, linkedAdultUserId);
  assert.ok(auditRows.length >= 2);
  assert.equal(outboxRows.length, 3);

  const replay = await service.acceptInvitation(command, meta);
  assert.equal(replay.status, 'linked');
  assert.equal(memberUpdates.length, 1);
  assert.equal(relationshipRows.length, 1);
  assert.equal(accessRows.length, 1);
  assert.equal(auditRows.length, 2);
  assert.equal(outboxRows.length, 3);
});

test('dependent account claims wait for guardian approval before linking the account', async () => {
  const invitationId = '10000000-0000-4000-8000-000000000020';
  const memberId = '10000000-0000-4000-8000-000000000021';
  const dependentPersonId = '10000000-0000-4000-8000-000000000022';
  const claimedPersonId = '10000000-0000-4000-8000-000000000023';
  const claimUserId = '10000000-0000-4000-8000-000000000024';
  const createdAt = new Date('2026-10-13T08:00:00.000Z');
  const idempotencyRows = new Map<string, { requestHash: string; response: unknown }>();
  const auditRows: Array<Record<string, unknown>> = [];
  const outboxRows: Array<Record<string, unknown>> = [];
  const accessRows: Array<Record<string, unknown>> = [];
  const state: {
    status: 'pending' | 'claim_pending' | 'accepted' | 'linked';
    claimUserId: string | null;
    acceptedByUserId: string | null;
    acceptedAt: Date | null;
    memberFamilyPersonId: string;
  } = {
    status: 'pending',
    claimUserId: null,
    acceptedByUserId: null,
    acceptedAt: null,
    memberFamilyPersonId: dependentPersonId,
  };
  const invitation = () => ({
    id: invitationId,
    householdId,
    memberId,
    relativeMemberId: null,
    kind: 'dependent_claim' as const,
    status: state.status,
    relationshipKind: null,
    relationshipBasis: null,
    newMemberIsFrom: null,
    targetUserId: null,
    targetPhoneHash: null,
    tokenHash: 'c'.repeat(64),
    tokenKeyVersion: 'v1',
    createdByUserId: actorUserId,
    acceptedByUserId: state.acceptedByUserId,
    claimUserId: state.claimUserId,
    expiresAt: null,
    acceptedAt: state.acceptedAt,
    createdAt,
    updatedAt: createdAt,
    member: {
      id: memberId,
      householdId,
      familyPersonId: state.memberFamilyPersonId,
      status: 'active' as const,
      isDependent: true,
      familyPerson: { accountUserId: null },
    },
  });
  const prisma = {
    idempotencyCommand: {
      findUnique: async ({
        where,
      }: {
        where: { callerService_key: { callerService: string; key: string } };
      }) =>
        idempotencyRows.get(
          `${where.callerService_key.callerService}:${where.callerService_key.key}`,
        ) ?? null,
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        idempotencyCommand: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            idempotencyRows.set(`${String(data.callerService)}:${String(data.key)}`, {
              requestHash: String(data.requestHash),
              response: data.response,
            });
          },
          update: async ({
            where,
            data,
          }: {
            where: { callerService_key: { callerService: string; key: string } };
            data: { response: unknown };
          }) => {
            const key = `${where.callerService_key.callerService}:${where.callerService_key.key}`;
            const row = idempotencyRows.get(key);
            assert.ok(row);
            idempotencyRows.set(key, { ...row, response: data.response });
          },
        },
        householdInvitation: {
          findFirst: async () => invitation(),
          findUnique: async () => invitation(),
          updateMany: async ({
            where,
            data,
          }: {
            where: { status: 'pending' | 'claim_pending' | 'accepted' };
            data: {
              status: 'claim_pending' | 'accepted' | 'linked';
              claimUserId?: string;
              acceptedByUserId?: string;
              acceptedAt?: Date;
            };
          }) => {
            if (state.status !== where.status) return { count: 0 };
            state.status = data.status;
            state.claimUserId = data.claimUserId ?? state.claimUserId;
            state.acceptedByUserId = data.acceptedByUserId ?? state.acceptedByUserId;
            state.acceptedAt = data.acceptedAt ?? state.acceptedAt;
            return { count: 1 };
          },
          findUniqueOrThrow: async () => invitation(),
        },
        householdAccess: {
          findFirst: async () => ({ role: 'guardian' }),
          upsert: async ({ create }: { create: Record<string, unknown> }) =>
            accessRows.push(create),
        },
        familyPerson: {
          upsert: async () => ({ id: claimedPersonId }),
          deleteMany: async () => undefined,
        },
        householdMember: {
          findFirst: async () => null,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            state.memberFamilyPersonId = String(data.familyPersonId);
          },
        },
        auditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => auditRows.push(data),
        },
        outboxEvent: {
          create: async ({ data }: { data: Record<string, unknown> }) => outboxRows.push(data),
        },
      };
      return work(tx);
    },
  } as unknown as PrismaService;
  const service = new CustomerHouseholdService(prisma);
  const claimMeta = {
    ...commandMeta('10000000-0000-4000-8000-000000000025'),
    actorUserId: claimUserId,
  };

  const claim = await service.acceptInvitation({ invitationId }, claimMeta);
  assert.equal(claim.status, 'claim_pending');
  assert.equal(state.status, 'claim_pending');
  assert.equal(state.memberFamilyPersonId, dependentPersonId);
  assert.equal(accessRows.length, 0);

  const approved = await service.approveDependentClaim(
    invitationId,
    commandMeta('10000000-0000-4000-8000-000000000026'),
  );
  assert.equal(approved.status, 'linked');
  assert.equal(state.status, 'linked');
  assert.equal(state.memberFamilyPersonId, claimedPersonId);
  assert.equal(accessRows.length, 1);
  assert.equal(accessRows[0]?.userId, claimUserId);
  assert.equal(accessRows[0]?.role, 'member');
  assert.equal(outboxRows.length, 2);
  assert.equal(auditRows.length, 2);
});
