import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  edgeTransactionImportedV2PayloadSchema,
  eventEnvelopeSchema,
  eventTypes,
} from '@funtino/event-contracts';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

type OutboxSummaryRow = {
  sourceInstanceId: string | null;
  deadLettered: boolean;
  count: bigint;
};

type OutboxReplayRow = {
  id: string;
  eventType: string;
  aggregateId: string;
  envelope: unknown;
  attempts: number;
  publishedAt: Date | null;
  deadLetteredAt: Date | null;
  lastErrorCode: string | null;
};

export type EdgeReplayCommand = {
  organizationId: string;
  branchId: string;
  eventId: string;
  reason: string;
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

@Injectable()
export class EdgeSyncOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBranchStatus(organizationId: string, branchId: string) {
    const installations = await this.prisma.edgeInstallation.findMany({
      where: { organizationId, branchId },
      orderBy: [{ lastHeartbeatAt: 'desc' }, { sourceInstanceId: 'asc' }],
      select: {
        sourceInstanceId: true,
        status: true,
        version: true,
        lastHeartbeatAt: true,
        createdAt: true,
      },
    });
    const [outboxCounts, outboxRows] = await Promise.all([
      this.prisma.$queryRaw<OutboxSummaryRow[]>(Prisma.sql`
        SELECT envelope -> 'payload' ->> 'sourceInstanceId' AS "sourceInstanceId",
               (dead_lettered_at IS NOT NULL) AS "deadLettered",
               COUNT(*) AS count
        FROM device_integration.outbox_events
        WHERE event_type = ${eventTypes.deviceEdgeTransactionImported}
          AND envelope ->> 'organizationId' = ${organizationId}
          AND envelope ->> 'branchId' = ${branchId}
          AND published_at IS NULL
        GROUP BY envelope -> 'payload' ->> 'sourceInstanceId', (dead_lettered_at IS NOT NULL)
      `),
      this.prisma.$queryRaw<Array<{
        outboxEventId: string;
        eventId: string | null;
        sourceInstanceId: string | null;
        localTransactionId: string | null;
        lastErrorCode: string | null;
        attempts: number;
        deadLetteredAt: Date | null;
        createdAt: Date;
      }>>(Prisma.sql`
        SELECT id AS "outboxEventId",
               envelope -> 'payload' ->> 'eventId' AS "eventId",
               envelope -> 'payload' ->> 'sourceInstanceId' AS "sourceInstanceId",
               envelope -> 'payload' ->> 'localTransactionId' AS "localTransactionId",
               last_error_code AS "lastErrorCode",
               attempts,
               dead_lettered_at AS "deadLetteredAt",
               created_at AS "createdAt"
        FROM device_integration.outbox_events
        WHERE event_type = ${eventTypes.deviceEdgeTransactionImported}
          AND envelope ->> 'organizationId' = ${organizationId}
          AND envelope ->> 'branchId' = ${branchId}
          AND published_at IS NULL AND dead_lettered_at IS NOT NULL
        ORDER BY dead_lettered_at DESC, id DESC
        LIMIT 100
      `),
    ]);
    const perInstallation = new Map<string, { pending: number; deadLetter: number }>();
    for (const row of outboxCounts) {
      if (!row.sourceInstanceId) continue;
      const current = perInstallation.get(row.sourceInstanceId) ?? { pending: 0, deadLetter: 0 };
      const count = Number(row.count);
      if (row.deadLettered) current.deadLetter += count;
      else current.pending += count;
      perInstallation.set(row.sourceInstanceId, current);
    }

    const items = await Promise.all(installations.map(async (installation) => {
      const [snapshot, latestEvent] = await Promise.all([
        this.prisma.edgeSnapshot.findFirst({
          where: { sourceInstanceId: installation.sourceInstanceId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { version: true, validUntil: true, createdAt: true },
        }),
        this.prisma.edgeTransactionImport.findFirst({
          where: { sourceInstanceId: installation.sourceInstanceId },
          orderBy: [{ receivedAt: 'desc' }, { eventId: 'desc' }],
          select: { eventId: true, receivedAt: true },
        }),
      ]);
      return {
        sourceInstanceId: installation.sourceInstanceId,
        status: installation.status,
        installationVersion: installation.version,
        registeredAt: installation.createdAt.toISOString(),
        lastHeartbeatAt: installation.lastHeartbeatAt?.toISOString() ?? null,
        snapshot: snapshot ? {
          version: snapshot.version,
          generatedAt: snapshot.createdAt.toISOString(),
          validUntil: snapshot.validUntil.toISOString(),
        } : null,
        lastEvent: latestEvent ? {
          eventId: latestEvent.eventId,
          receivedAt: latestEvent.receivedAt.toISOString(),
        } : null,
        outbox: perInstallation.get(installation.sourceInstanceId) ?? { pending: 0, deadLetter: 0 },
      };
    }));

    return {
      organizationId,
      branchId,
      installations: items,
      pendingCount: items.reduce((sum, item) => sum + item.outbox.pending, 0),
      deadLetterCount: items.reduce((sum, item) => sum + item.outbox.deadLetter, 0),
      deadLetters: outboxRows.map((row) => ({
        outboxEventId: row.outboxEventId,
        eventId: isUuid(row.eventId) ? row.eventId : null,
        sourceInstanceId: isUuid(row.sourceInstanceId) ? row.sourceInstanceId : null,
        localTransactionId: row.localTransactionId && row.localTransactionId.length <= 160 ? row.localTransactionId : null,
        errorCode: row.lastErrorCode ?? 'DELIVERY_FAILED',
        attempts: row.attempts,
        deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      deadLettersTruncated: outboxRows.length === 100,
    };
  }

  async replayDeadLetter(input: EdgeReplayCommand) {
    const reason = input.reason.trim();
    if (reason.length < 10 || reason.length > 500) throw new ConflictException('Replay reason is invalid.');
    const requestHash = createHash('sha256').update(JSON.stringify({
      organizationId: input.organizationId,
      branchId: input.branchId,
      eventId: input.eventId,
      reason,
    })).digest('hex');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const command = await tx.idempotencyCommand.findUnique({
          where: { callerService_key: { callerService: 'api-gateway', key: input.idempotencyKey } },
        });
        if (command) {
          if (command.requestHash.trim() !== requestHash)
            throw new ConflictException('Idempotency key was already used with a different replay request.');
          return command.response as { eventId: string; status: 'queued_for_replay'; outboxEventId: string };
        }

        const rows = await tx.$queryRaw<OutboxReplayRow[]>(Prisma.sql`
          SELECT id, event_type AS "eventType", aggregate_id AS "aggregateId", envelope,
                 attempts, published_at AS "publishedAt", dead_lettered_at AS "deadLetteredAt",
                 last_error_code AS "lastErrorCode"
          FROM device_integration.outbox_events
          WHERE event_type = ${eventTypes.deviceEdgeTransactionImported}
            AND envelope ->> 'organizationId' = ${input.organizationId}
            AND envelope ->> 'branchId' = ${input.branchId}
            AND envelope -> 'payload' ->> 'eventId' = ${input.eventId}
          FOR UPDATE
        `);
        const row = rows[0];
        if (!row) throw new NotFoundException('Dead-letter event was not found in this branch.');
        if (row.publishedAt || !row.deadLetteredAt)
          throw new ConflictException('Only an unpublished dead-letter event can be replayed.');

        const envelope = eventEnvelopeSchema.safeParse(row.envelope);
        const payload = envelope.success
          ? edgeTransactionImportedV2PayloadSchema.safeParse(envelope.data.payload)
          : null;
        if (!envelope.success || envelope.data.eventId !== row.id || envelope.data.eventType !== row.eventType ||
          envelope.data.sourceId !== 'device-integration' || envelope.data.organizationId !== input.organizationId ||
          envelope.data.branchId !== input.branchId || !payload?.success || payload.data.eventId !== input.eventId ||
          envelope.data.aggregateId !== payload.data.cardId)
          throw new ConflictException('Dead-letter envelope failed its event contract checks.');
        const installation = await tx.edgeInstallation.findFirst({
          where: {
            sourceInstanceId: payload.data.sourceInstanceId,
            organizationId: input.organizationId,
            branchId: input.branchId,
          },
          select: { sourceInstanceId: true },
        });
        if (!installation) throw new ConflictException('Dead-letter event installation scope is no longer registered.');

        const response = { eventId: input.eventId, status: 'queued_for_replay' as const, outboxEventId: row.id };
        const updated = await tx.outboxEvent.updateMany({
          where: { id: row.id, publishedAt: null, deadLetteredAt: { not: null } },
          data: {
            attempts: 0,
            availableAt: new Date(),
            deadLetteredAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (updated.count !== 1) throw new ConflictException('Dead-letter event changed before replay.');

        await tx.edgeOutboxReplayAudit.create({
          data: {
            id: randomUUID(),
            outboxEventId: row.id,
            eventId: input.eventId,
            sourceInstanceId: payload.data.sourceInstanceId,
            organizationId: input.organizationId,
            branchId: input.branchId,
            actorUserId: input.actorUserId,
            callerService: 'api-gateway',
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            reason,
            previousErrorCode: row.lastErrorCode,
            previousAttempts: row.attempts,
          },
        });
        await tx.idempotencyCommand.create({
          data: {
            callerService: 'api-gateway',
            key: input.idempotencyKey,
            requestHash,
            response: response as unknown as Prisma.InputJsonValue,
          },
        });
        return response;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const command = await this.prisma.idempotencyCommand.findUnique({
        where: { callerService_key: { callerService: 'api-gateway', key: input.idempotencyKey } },
      });
      if (command?.requestHash.trim() === requestHash)
        return command.response as { eventId: string; status: 'queued_for_replay'; outboxEventId: string };
      throw new ConflictException('Replay conflicts with another request.');
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isUuid(value: string | null): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
