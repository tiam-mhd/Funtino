import { BadRequestException, Injectable } from '@nestjs/common';
import {
  createEventEnvelope,
  eventTypes,
  identityPolicyChangedPayloadSchema,
} from '@funtino/event-contracts';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/index.js';
import type { AccessScope } from '../domain/authorization/authorization-evaluator.js';
import { z } from 'zod';
import type { z as Zod } from 'zod';

type ChangePayload = Pick<
  Zod.infer<typeof identityPolicyChangedPayloadSchema>,
  'changeType' | 'targetType'
>;

const uuidSchema = z.string().uuid();
const auditScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('organization'), organizationId: uuidSchema }).strict(),
  z
    .object({ type: z.literal('branch'), organizationId: uuidSchema, branchId: uuidSchema })
    .strict(),
]);
const accessAuditSnapshotSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('role'),
      id: uuidSchema,
      name: z.string().trim().min(1).max(80),
      status: z.enum(['active', 'disabled']),
      scope: auditScopeSchema,
      systemManaged: z.boolean(),
      version: z.number().int().positive(),
      permissionKeys: z.array(z.string().min(1).max(120)).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('membership'),
      id: uuidSchema,
      status: z.enum(['pending', 'active', 'suspended', 'revoked']),
      scope: auditScopeSchema,
      roleId: uuidSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('permission_override'),
      id: uuidSchema,
      membershipId: uuidSchema,
      permissionKey: z.string().min(1).max(120),
      effect: z.enum(['allow', 'deny']),
      scope: auditScopeSchema,
      resource: z
        .object({ type: z.string().min(1).max(80), id: z.string().min(1).max(160) })
        .strict()
        .optional(),
      startsAt: z.string().datetime({ offset: true }),
      expiresAt: z.string().datetime({ offset: true }).nullable(),
      revokedAt: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
]);

type AccessAuditSnapshot = Zod.infer<typeof accessAuditSnapshotSchema>;

export type RecordCommittedAccessChange = ChangePayload & {
  actorUserId: string | null;
  actorType?: 'user' | 'system';
  actorLabel?: string;
  targetId: string;
  scope: AccessScope;
  reason: string;
  correlationId: string;
  beforeState?: AccessAuditSnapshot | null;
  afterState?: AccessAuditSnapshot | null;
};

export type RecordDeniedAccessAttempt = {
  actorUserId: string;
  action: string;
  targetType: 'role' | 'membership' | 'permission_override';
  targetId: string;
  scope: AccessScope;
  reason: string;
  correlationId: string;
};

export type RecordSensitiveAccess = Omit<RecordDeniedAccessAttempt, 'reason' | 'targetType'> & {
  targetType: 'role' | 'membership' | 'permission_override' | 'audit_log';
  reason: string;
  policyVersion: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSnapshot(
  snapshot: AccessAuditSnapshot | null | undefined,
  targetType: RecordCommittedAccessChange['targetType'],
  targetId: string,
): Prisma.InputJsonObject | undefined {
  if (snapshot == null) return undefined;
  const parsed = accessAuditSnapshotSchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.kind !== targetType || parsed.data.id !== targetId) {
    throw new BadRequestException('Invalid access change audit snapshot.');
  }
  return parsed.data as Prisma.InputJsonObject;
}

function assertValidInput(input: RecordCommittedAccessChange): {
  beforeState: Prisma.InputJsonObject | undefined;
  afterState: Prisma.InputJsonObject | undefined;
} {
  const payload = identityPolicyChangedPayloadSchema.safeParse({
    auditId: randomUUID(),
    policyVersion: 1,
    changeType: input.changeType,
    targetType: input.targetType,
    targetId: input.targetId,
  });
  const scopeIds =
    input.scope.type === 'global'
      ? []
      : input.scope.type === 'organization'
        ? [input.scope.organizationId]
        : [input.scope.organizationId, input.scope.branchId];
  const expectedTargetType = input.changeType.startsWith('role.')
    ? 'role'
    : input.changeType.startsWith('membership.')
      ? 'membership'
      : 'permission_override';
  const actorType = input.actorType ?? 'user';
  const actorValid =
    (actorType === 'user' && input.actorUserId !== null && uuidPattern.test(input.actorUserId)) ||
    (actorType === 'system' &&
      input.actorUserId === null &&
      typeof input.actorLabel === 'string' &&
      input.actorLabel.trim().length > 0 &&
      input.actorLabel.trim().length <= 100);

  if (
    !payload.success ||
    !actorValid ||
    !uuidPattern.test(input.correlationId) ||
    scopeIds.some((id) => !uuidPattern.test(id)) ||
    input.targetType !== expectedTargetType ||
    input.reason.trim().length < 8 ||
    input.reason.trim().length > 500
  ) {
    throw new BadRequestException('Invalid access change audit context.');
  }

  return {
    beforeState: parseSnapshot(input.beforeState, input.targetType, input.targetId),
    afterState: parseSnapshot(input.afterState, input.targetType, input.targetId),
  };
}

@Injectable()
export class AccessMutationJournalService {
  /** Records an authorized read of sensitive IAM data without changing policy version or emitting a mutation event. */
  async recordSensitiveAccess(
    tx: Prisma.TransactionClient,
    input: RecordSensitiveAccess,
  ): Promise<{ auditId: string }> {
    const scopeIds = input.scope.type === 'global'
      ? []
      : input.scope.type === 'organization'
        ? [input.scope.organizationId]
        : [input.scope.organizationId, input.scope.branchId];
    if (
      !uuidPattern.test(input.actorUserId) || !uuidPattern.test(input.correlationId) ||
      !uuidPattern.test(input.targetId) || scopeIds.some((id) => !uuidPattern.test(id)) ||
      !/^[a-z][a-z0-9._-]{1,119}$/.test(input.action) ||
      !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1 ||
      input.reason.trim().length < 8 || input.reason.trim().length > 500
    ) {
      throw new BadRequestException('Invalid sensitive access audit context.');
    }
    const scopeColumns = {
      scopeType: input.scope.type,
      organizationId: input.scope.type === 'global' ? null : input.scope.organizationId,
      branchId: input.scope.type === 'branch' ? input.scope.branchId : null,
    };
    const audit = await tx.accessAuditLog.create({
      data: {
        actorType: 'user', actorUserId: input.actorUserId, action: input.action,
        targetType: input.targetType, targetId: input.targetId, ...scopeColumns,
        reason: input.reason.trim(), policyVersion: input.policyVersion,
        correlationId: input.correlationId, outcome: 'succeeded',
      },
      select: { id: true },
    });
    return { auditId: audit.id };
  }

  /**
   * Must be called with the transaction that performs the access-policy mutation.
   * The policy version, immutable audit row, and event outbox row commit or roll back together.
   */
  async recordCommittedChange(
    tx: Prisma.TransactionClient,
    input: RecordCommittedAccessChange,
  ): Promise<{ auditId: string; eventId: string; policyVersion: number }> {
    const snapshots = assertValidInput(input);

    const auditId = randomUUID();
    const { version: policyVersion } = await tx.policyState.update({
      where: { id: 1 },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    const scopeColumns = {
      scopeType: input.scope.type,
      organizationId: input.scope.type === 'global' ? null : input.scope.organizationId,
      branchId: input.scope.type === 'branch' ? input.scope.branchId : null,
    };

    const event = createEventEnvelope({
      eventType: eventTypes.identityPolicyChanged,
      sourceId: 'identity-access',
      aggregateId: input.targetId,
      correlationId: input.correlationId,
      organizationId: scopeColumns.organizationId,
      branchId: scopeColumns.branchId,
      payload: {
        auditId,
        policyVersion,
        changeType: input.changeType,
        targetType: input.targetType,
        targetId: input.targetId,
      },
    });

    await tx.accessAuditLog.create({
      data: {
        id: auditId,
        actorType: input.actorType ?? 'user',
        actorUserId: input.actorUserId,
        ...(input.actorType === 'system' ? { actorLabel: input.actorLabel!.trim() } : {}),
        action: input.changeType,
        targetType: input.targetType,
        targetId: input.targetId,
        ...scopeColumns,
        reason: input.reason.trim(),
        ...(snapshots.beforeState ? { beforeState: snapshots.beforeState } : {}),
        ...(snapshots.afterState ? { afterState: snapshots.afterState } : {}),
        policyVersion,
        correlationId: input.correlationId,
        outcome: 'succeeded',
      },
    });
    await tx.outboxEvent.create({
      data: {
        id: event.eventId,
        auditLogId: auditId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        aggregateId: event.aggregateId,
        envelope: event as Prisma.InputJsonValue,
      },
    });

    return { auditId, eventId: event.eventId, policyVersion };
  }

  async recordDeniedAttempt(
    tx: Prisma.TransactionClient,
    input: RecordDeniedAccessAttempt,
  ): Promise<{ auditId: string }> {
    const scopeIds =
      input.scope.type === 'global'
        ? []
        : input.scope.type === 'organization'
          ? [input.scope.organizationId]
          : [input.scope.organizationId, input.scope.branchId];
    if (
      !uuidPattern.test(input.actorUserId) ||
      !uuidPattern.test(input.correlationId) ||
      !uuidPattern.test(input.targetId) ||
      scopeIds.some((id) => !uuidPattern.test(id)) ||
      !/^[a-z][a-z0-9._-]{1,119}$/.test(input.action) ||
      input.reason.trim().length < 8 ||
      input.reason.trim().length > 500
    ) {
      throw new BadRequestException('Invalid denied access audit context.');
    }
    const scopeColumns = {
      scopeType: input.scope.type,
      organizationId: input.scope.type === 'global' ? null : input.scope.organizationId,
      branchId: input.scope.type === 'branch' ? input.scope.branchId : null,
    };
    const audit = await tx.accessAuditLog.create({
      data: {
        actorType: 'user',
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...scopeColumns,
        reason: input.reason.trim(),
        correlationId: input.correlationId,
        outcome: 'denied',
      },
      select: { id: true },
    });
    return { auditId: audit.id };
  }
}
