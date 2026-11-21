import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  createEventEnvelope,
  deviceTransactionImportedPayloadSchema,
  edgeTransactionImportedV2PayloadSchema,
  eventTypes,
} from '@funtino/event-contracts';
import {
  Prisma,
  type BalanceFreshness,
  type CardLedgerKind,
} from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import type { z } from 'zod';

export type EdgeLedgerPayload = z.infer<typeof edgeTransactionImportedV2PayloadSchema>;

export type LedgerApplyResult =
  | { status: 'accepted' | 'duplicate'; errorCode: null }
  | { status: 'pending_review'; errorCode: string };

export type PhysicalBalanceSnapshot = {
  snapshotId: string;
  sourceInstanceId: string;
  organizationId: string;
  branchId: string;
  cardId: string;
  householdId: string;
  memberId: string | null;
  snapshotVersion: string;
  localSequence: number;
  balanceRial: number;
  currencyCode: 'IRR';
  observedAt: string;
};

@Injectable()
export class CardLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async applyEdgeEvent(
    event: EdgeLedgerPayload,
    correlationId: string,
  ): Promise<LedgerApplyResult> {
    const occurredAt = new Date(event.occurredAt);
    const requestHash = hash(event);
    const existing = await this.prisma.edgeEventInbox.findUnique({
      where: { eventId: event.eventId },
    });
    if (existing) {
      if (existing.requestHash.trim() !== requestHash)
        throw new ConflictException('Event identifier conflicts with an existing payload.');
      return existing.status === 'accepted'
        ? { status: 'duplicate', errorCode: null }
        : { status: 'pending_review', errorCode: existing.errorCode ?? 'REVIEW_REQUIRED' };
    }
    const existingTransaction = await this.prisma.edgeEventInbox.findUnique({
      where: {
        sourceInstanceId_localTransactionId: {
          sourceInstanceId: event.sourceInstanceId,
          localTransactionId: event.localTransactionId,
        },
      },
    });
    if (existingTransaction) {
      if (
        existingTransaction.eventId === event.eventId &&
        existingTransaction.requestHash.trim() === requestHash
      )
        return existingTransaction.status === 'accepted'
          ? { status: 'duplicate', errorCode: null }
          : {
              status: 'pending_review',
              errorCode: existingTransaction.errorCode ?? 'REVIEW_REQUIRED',
            };
      throw new ConflictException('Local transaction identifier conflicts with an existing event.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.edgeEventInbox.findUnique({ where: { eventId: event.eventId } });
        if (duplicate) {
          if (duplicate.requestHash.trim() !== requestHash)
            throw new ConflictException('Event identifier conflicts with an existing payload.');
          return duplicate.status === 'accepted'
            ? { status: 'duplicate' as const, errorCode: null }
            : {
                status: 'pending_review' as const,
                errorCode: duplicate.errorCode ?? 'REVIEW_REQUIRED',
              };
        }

        if (event.operationResult !== 'success') {
          await tx.edgeEventInbox.create({
            data: {
              eventId: event.eventId,
              sourceInstanceId: event.sourceInstanceId,
              localTransactionId: event.localTransactionId,
              cardId: event.cardId,
              requestHash,
              eventPayload: event as unknown as Prisma.InputJsonValue,
              status: 'accepted',
              retryable: false,
              appliedAt: new Date(),
            },
          });
          return { status: 'accepted' as const, errorCode: null };
        }

        const problem = await this.validateEventOwner(tx, event, occurredAt);
        if (problem) {
          await tx.edgeEventInbox.create({
            data: {
              eventId: event.eventId,
              sourceInstanceId: event.sourceInstanceId,
              localTransactionId: event.localTransactionId,
              cardId: event.cardId,
              requestHash,
              eventPayload: event as unknown as Prisma.InputJsonValue,
              status: 'pending_review',
              errorCode: problem,
              retryable: false,
            },
          });
          return { status: 'pending_review' as const, errorCode: problem };
        }

        let reversalOfEntryId: string | null = null;
        if (event.transactionKind === 'refund' || event.transactionKind === 'adjustment') {
          const reversal = event.reversalOfLocalTransactionId
            ? await tx.cardLedgerEntry.findFirst({
                where: {
                  sourceInstanceId: event.sourceInstanceId,
                  localTransactionId: event.reversalOfLocalTransactionId,
                },
                select: { id: true, cardId: true },
              })
            : null;
          const reversalError = !event.reversalOfLocalTransactionId
            ? 'REVERSAL_REFERENCE_REQUIRED'
            : !reversal
              ? 'REVERSAL_TARGET_NOT_FOUND'
              : reversal.cardId !== event.cardId
                ? 'REVERSAL_CARD_MISMATCH'
                : null;
          if (reversalError) {
            await tx.edgeEventInbox.create({
              data: {
                eventId: event.eventId,
                sourceInstanceId: event.sourceInstanceId,
                localTransactionId: event.localTransactionId,
                cardId: event.cardId,
                requestHash,
                eventPayload: event as unknown as Prisma.InputJsonValue,
                status: 'pending_review',
                errorCode: reversalError,
                retryable: false,
              },
            });
            return { status: 'pending_review' as const, errorCode: reversalError };
          }
          reversalOfEntryId = reversal!.id;
        }

        if (event.grossAmountRial - event.discountAmountRial !== event.netAmountRial) {
          await tx.edgeEventInbox.create({
            data: {
              eventId: event.eventId,
              sourceInstanceId: event.sourceInstanceId,
              localTransactionId: event.localTransactionId,
              cardId: event.cardId,
              requestHash,
              eventPayload: event as unknown as Prisma.InputJsonValue,
              status: 'pending_review',
              errorCode: 'AMOUNT_BREAKDOWN_MISMATCH',
              retryable: false,
            },
          });
          return { status: 'pending_review' as const, errorCode: 'AMOUNT_BREAKDOWN_MISMATCH' };
        }

        const entryId = randomUUID();
        await tx.cardLedgerEntry.create({
          data: {
            id: entryId,
            eventId: event.eventId,
            sourceInstanceId: event.sourceInstanceId,
            localTransactionId: event.localTransactionId,
            sourceDatabase: event.sourceDatabase,
            organizationId: event.organizationId,
            branchId: event.branchId,
            cardId: event.cardId,
            householdId: event.householdId,
            memberId: event.memberId,
            deviceId: event.deviceId,
            sourceDeviceId: event.sourceDeviceId,
            attractionId: event.attractionId,
            transactionKind: event.transactionKind as CardLedgerKind,
            amountRial: BigInt(event.amountRial),
            currencyCode: event.currencyCode,
            grossAmountRial: BigInt(event.grossAmountRial),
            discountAmountRial: BigInt(event.discountAmountRial),
            netAmountRial: BigInt(event.netAmountRial),
            promotionId: event.promotionId,
            ruleId: event.ruleId,
            pricingVersion: event.pricingVersion,
            reversalOfEntryId,
            snapshotVersion: event.snapshotVersion,
            occurredAt,
            localSequence: BigInt(event.localSequence),
            balanceAfterRial:
              event.balanceAfterRial === null ? null : BigInt(event.balanceAfterRial),
            operationResult: 'success',
          },
        });
        await this.updateProjection(tx, event);
        await tx.edgeEventInbox.create({
          data: {
            eventId: event.eventId,
            sourceInstanceId: event.sourceInstanceId,
            localTransactionId: event.localTransactionId,
            cardId: event.cardId,
            requestHash,
            eventPayload: event as unknown as Prisma.InputJsonValue,
            status: 'accepted',
            retryable: false,
            appliedAt: new Date(),
          },
        });
        const projection = await tx.cardBalanceProjection.findUnique({
          where: { cardId: event.cardId },
        });
        const envelope = createEventEnvelope({
          eventType: eventTypes.walletCardLedgerEntryCreatedV2,
          sourceId: 'wallet',
          aggregateId: event.cardId,
          organizationId: event.organizationId,
          branchId: event.branchId,
          correlationId,
          payload: {
            entryId,
            cardId: event.cardId,
            householdId: event.householdId,
            freshness: projection?.freshness ?? 'unknown',
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: envelope.eventId,
            eventType: envelope.eventType,
            aggregateId: envelope.aggregateId,
            envelope: envelope as unknown as Prisma.InputJsonValue,
          },
        });
        return { status: 'accepted' as const, errorCode: null };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existingEvent = await this.prisma.edgeEventInbox.findUnique({
        where: { eventId: event.eventId },
      });
      const existingTransaction = await this.prisma.edgeEventInbox.findUnique({
        where: {
          sourceInstanceId_localTransactionId: {
            sourceInstanceId: event.sourceInstanceId,
            localTransactionId: event.localTransactionId,
          },
        },
      });
      const duplicate = existingEvent ?? existingTransaction;
      if (duplicate?.eventId === event.eventId && duplicate.requestHash.trim() === requestHash) {
        return duplicate.status === 'accepted'
          ? { status: 'duplicate', errorCode: null }
          : { status: 'pending_review', errorCode: duplicate.errorCode ?? 'REVIEW_REQUIRED' };
      }
      throw new ConflictException(
        'Event or local transaction identifier conflicts with an existing payload.',
      );
    }
  }

  async importLegacyDeviceEvent(input: {
    payload: unknown;
    organizationId: string;
    branchId: string;
  }): Promise<{ accepted: true; duplicate: boolean }> {
    const parsed = deviceTransactionImportedPayloadSchema.safeParse(input.payload);
    if (!parsed.success) throw new ConflictException('Legacy device event violates its contract.');
    const payload = parsed.data;
    const requestHash = hash({
      ...payload,
      organizationId: input.organizationId,
      branchId: input.branchId,
    });
    const existing = await this.prisma.legacyDeviceImport.findUnique({
      where: { externalEventId: payload.externalEventId },
    });
    if (existing) {
      if (existing.requestHash.trim() !== requestHash)
        throw new ConflictException('Legacy event identifier conflicts with an existing payload.');
      return { accepted: true, duplicate: true };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const card = await tx.cardInventory.findFirst({
          where: {
            externalCardId: payload.externalCardId,
            organizationId: input.organizationId,
            branchId: input.branchId,
          },
          select: { id: true, organizationId: true, branchId: true },
        });
        await tx.legacyDeviceImport.create({
          data: {
            externalEventId: payload.externalEventId,
            requestHash,
            transactionId: payload.transactionId,
            organizationId: input.organizationId,
            branchId: input.branchId,
            cardId: card?.id ?? null,
            deviceId: payload.deviceId ?? null,
            sourceDeviceId: payload.sourceDeviceId ?? null,
            transactionKind: payload.transactionKind,
            amountMinor: BigInt(payload.amountMinor),
            currency: payload.currency,
            occurredAt: new Date(payload.occurredAt),
            status: card ? 'resolved' : 'needs_mapping',
          },
        });
      });
      return { accepted: true, duplicate: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.prisma.legacyDeviceImport.findUnique({
        where: { externalEventId: payload.externalEventId },
      });
      if (duplicate?.requestHash.trim() === requestHash) return { accepted: true, duplicate: true };
      throw new ConflictException('Legacy event identifier conflicts with an existing payload.');
    }
  }

  async getCardSummary(householdId: string, cardId: string) {
    const assignment = await this.prisma.cardAssignment.findFirst({
      where: { cardId, householdId },
      select: { id: true, memberId: true },
    });
    if (!assignment) throw new NotFoundException('Card assignment not found.');
    const projection = await this.prisma.cardBalanceProjection.findUnique({ where: { cardId } });
    const pendingTransactionCount = await this.prisma.edgeEventInbox.count({
      where: { cardId, status: 'pending_review' },
    });
    const balance = safeNumber(projection?.balanceRial ?? null);
    return {
      householdId,
      cardId,
      memberId: assignment.memberId,
      balanceRial: balance,
      lastConfirmedSnapshotAt: projection?.lastConfirmedSnapshotAt?.toISOString() ?? null,
      lastAppliedEventId: projection?.lastAppliedEventId ?? null,
      freshness: balance === null ? 'unknown' : (projection?.freshness ?? 'unknown'),
      pendingTransactionCount,
      reconciliationDifferenceRial: safeNumber(projection?.reconciliationDifferenceRial ?? null),
    };
  }

  async getBranchEdgeReviewSummary(organizationId: string, branchId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        status: string;
        errorCode: string | null;
        count: bigint;
        latestAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT inbox.status::text AS status,
             inbox.error_code AS "errorCode",
             COUNT(*) AS count,
             MAX(inbox.received_at) AS "latestAt"
      FROM wallet.edge_event_inbox AS inbox
      INNER JOIN wallet.card_inventory AS card ON card.id = inbox.card_id
      WHERE card.organization_id = ${organizationId}::uuid
        AND card.branch_id = ${branchId}::uuid
        AND inbox.status IN ('pending_review', 'rejected')
      GROUP BY inbox.status, inbox.error_code
      ORDER BY inbox.status, inbox.error_code
    `);
    const errorsByCode = new Map<string, number>();
    let reviewCount = 0;
    let rejectedCount = 0;
    let latestAt: Date | null = null;
    for (const row of rows) {
      const count = Number(row.count);
      reviewCount += count;
      if (row.status === 'rejected') rejectedCount += count;
      if (row.errorCode)
        errorsByCode.set(row.errorCode, (errorsByCode.get(row.errorCode) ?? 0) + count);
      if (row.latestAt && (!latestAt || row.latestAt > latestAt)) latestAt = row.latestAt;
    }
    return {
      organizationId,
      branchId,
      reviewCount,
      rejectedCount,
      latestReviewAt: latestAt?.toISOString() ?? null,
      errorsByCode: [...errorsByCode.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([errorCode, count]) => ({ errorCode, count })),
    };
  }

  async reconcilePhysicalBalanceSnapshot(input: PhysicalBalanceSnapshot) {
    const observedAt = new Date(input.observedAt);
    if (!Number.isFinite(observedAt.valueOf()) || observedAt.getTime() > Date.now() + 60_000)
      throw new ConflictException('Physical card snapshot time is invalid.');
    const requestHash = hash({ ...input, observedAt: observedAt.toISOString() });
    const existing = await this.prisma.cardBalanceReconciliation.findUnique({
      where: { snapshotId: input.snapshotId },
    });
    if (existing) {
      if (existing.requestHash.trim() !== requestHash)
        throw new ConflictException(
          'Snapshot identifier conflicts with an existing reconciliation.',
        );
      return reconciliationResult(existing, true);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM wallet.card_inventory WHERE id = ${input.cardId}::uuid FOR UPDATE
        `);
        const duplicate = await tx.cardBalanceReconciliation.findUnique({
          where: { snapshotId: input.snapshotId },
        });
        if (duplicate) {
          if (duplicate.requestHash.trim() !== requestHash)
            throw new ConflictException(
              'Snapshot identifier conflicts with an existing reconciliation.',
            );
          return reconciliationResult(duplicate, true);
        }

        const card = await tx.cardInventory.findFirst({
          where: {
            id: input.cardId,
            organizationId: input.organizationId,
            branchId: input.branchId,
            status: 'assigned',
            verificationStatus: 'verified',
          },
          select: { id: true },
        });
        if (!card)
          throw new ConflictException('Physical card is not verified and assigned in this branch.');

        const activeAssignment = await tx.cardAssignment.findFirst({
          where: {
            cardId: input.cardId,
            organizationId: input.organizationId,
            branchId: input.branchId,
            householdId: input.householdId,
            memberId: input.memberId,
            assignedAt: { lte: observedAt },
          },
          select: { id: true },
        });
        if (!activeAssignment)
          throw new ConflictException(
            'Physical snapshot owner is not the current verified card holder.',
          );

        const ownerAtRead = await tx.cardAssignmentHistory.findFirst({
          where: { cardId: input.cardId, createdAt: { lte: observedAt } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { action: true, householdId: true, memberId: true },
        });
        if (ownerAtRead) {
          if (
            ownerAtRead.action === 'cancelled' ||
            ownerAtRead.householdId !== input.householdId ||
            ownerAtRead.memberId !== input.memberId
          )
            throw new ConflictException(
              'Snapshot household ownership does not match the physical read time.',
            );
        }

        const current = await tx.cardBalanceProjection.findUnique({
          where: { cardId: input.cardId },
        });
        if (current?.lastConfirmedSnapshotAt && current.lastConfirmedSnapshotAt > observedAt)
          throw new ConflictException(
            'Physical snapshot predates the latest confirmed balance read.',
          );
        const latestEvent = await tx.cardLedgerEntry.findFirst({
          where: { cardId: input.cardId, sourceInstanceId: input.sourceInstanceId },
          orderBy: [{ localSequence: 'desc' }, { id: 'desc' }],
          select: { localSequence: true },
        });
        const latestSequence = latestEvent?.localSequence ?? null;
        const snapshotSequence = BigInt(input.localSequence);
        if (latestSequence !== null && snapshotSequence < latestSequence)
          throw new ConflictException(
            'Physical snapshot is older than an applied card transaction.',
          );

        const previousBalanceRial = current?.balanceRial ?? null;
        const differenceRial =
          previousBalanceRial === null ? null : BigInt(input.balanceRial) - previousBalanceRial;
        // localSequence is installation-wide; it cannot tell us how many events
        // for this card are missing. The physical read is authoritative, while a
        // ledger mismatch remains visible as stale until investigated.
        const pendingTransactionCount = 0;
        const freshness =
          differenceRial !== null && differenceRial !== 0n
            ? ('stale' as const)
            : ('fresh' as const);
        await tx.cardBalanceProjection.upsert({
          where: { cardId: input.cardId },
          create: {
            cardId: input.cardId,
            balanceRial: BigInt(input.balanceRial),
            lastConfirmedSnapshotAt: observedAt,
            lastSnapshotSourceInstanceId: input.sourceInstanceId,
            lastSnapshotLocalSequence: snapshotSequence,
            freshness,
            pendingTransactionCount,
            reconciliationDifferenceRial: differenceRial,
          },
          update: {
            balanceRial: BigInt(input.balanceRial),
            lastConfirmedSnapshotAt: observedAt,
            lastSnapshotSourceInstanceId: input.sourceInstanceId,
            lastSnapshotLocalSequence: snapshotSequence,
            freshness,
            pendingTransactionCount,
            reconciliationDifferenceRial: differenceRial,
            updatedAt: new Date(),
          },
        });
        const reconciliation = await tx.cardBalanceReconciliation.create({
          data: {
            id: randomUUID(),
            snapshotId: input.snapshotId,
            requestHash,
            sourceInstanceId: input.sourceInstanceId,
            organizationId: input.organizationId,
            branchId: input.branchId,
            cardId: input.cardId,
            householdId: input.householdId,
            memberId: input.memberId,
            snapshotVersion: input.snapshotVersion,
            localSequence: BigInt(input.localSequence),
            balanceRial: BigInt(input.balanceRial),
            previousBalanceRial,
            differenceRial,
            currencyCode: input.currencyCode,
            freshness,
            observedAt,
          },
        });
        return reconciliationResult(reconciliation, false);
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.prisma.cardBalanceReconciliation.findUnique({
        where: { snapshotId: input.snapshotId },
      });
      if (duplicate?.requestHash.trim() === requestHash)
        return reconciliationResult(duplicate, true);
      throw new ConflictException('Snapshot identifier conflicts with another reconciliation.');
    }
  }

  async listEdgeCardMappings(organizationId: string, branchId: string) {
    const assignments = await this.prisma.cardAssignment.findMany({
      where: {
        organizationId,
        branchId,
        card: { status: 'assigned', verificationStatus: 'verified', cardUidHash: { not: null } },
      },
      include: { card: { select: { id: true, cardUidHash: true } } },
      orderBy: [{ cardId: 'asc' }],
    });
    return assignments.map((assignment) => ({
      cardId: assignment.card.id,
      cardUidHash: assignment.card.cardUidHash!,
      householdId: assignment.householdId,
      memberId: assignment.memberId,
    }));
  }

  async listTransactions(input: {
    householdId: string;
    cardId: string;
    cursor?: string;
    pageSize: number;
    kind?: string;
    from?: string;
    to?: string;
  }) {
    const assignment = await this.prisma.cardAssignment.findFirst({
      where: { cardId: input.cardId, householdId: input.householdId },
      select: { id: true },
    });
    if (!assignment) throw new NotFoundException('Card assignment not found.');
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const rows = await this.prisma.cardLedgerEntry.findMany({
      where: {
        cardId: input.cardId,
        householdId: input.householdId,
        ...(input.kind ? { transactionKind: input.kind as CardLedgerKind } : {}),
        ...(input.from || input.to
          ? {
              occurredAt: {
                ...(input.from ? { gte: new Date(input.from) } : {}),
                ...(input.to ? { lte: new Date(input.to) } : {}),
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { occurredAt: { gt: cursor.occurredAt } },
                { occurredAt: cursor.occurredAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: input.pageSize + 1,
    });
    const hasMore = rows.length > input.pageSize;
    const selected = rows.slice(0, input.pageSize);
    return {
      items: selected.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        cardId: row.cardId,
        householdId: row.householdId,
        memberId: row.memberId,
        deviceId: row.deviceId,
        transactionKind: row.transactionKind,
        amountRial: safeNumber(row.amountRial),
        grossAmountRial: safeNumber(row.grossAmountRial),
        discountAmountRial: safeNumber(row.discountAmountRial),
        netAmountRial: safeNumber(row.netAmountRial),
        currencyCode: row.currencyCode,
        promotionId: row.promotionId,
        ruleId: row.ruleId,
        pricingVersion: row.pricingVersion,
        reversalOfEntryId: row.reversalOfEntryId,
        occurredAt: row.occurredAt.toISOString(),
        status: 'confirmed' as const,
      })),
      nextCursor:
        hasMore && selected.length
          ? encodeCursor(selected.at(-1)!.occurredAt, selected.at(-1)!.id)
          : null,
    };
  }

  private async validateEventOwner(
    tx: Prisma.TransactionClient,
    event: EdgeLedgerPayload,
    occurredAt: Date,
  ): Promise<string | null> {
    const card = await tx.cardInventory.findFirst({
      where: { id: event.cardId, organizationId: event.organizationId, branchId: event.branchId },
      select: { id: true, verificationStatus: true },
    });
    if (!card) return 'CARD_NOT_REGISTERED';
    if (card.verificationStatus !== 'verified') return 'CARD_NOT_VERIFIED';

    const history = await tx.cardAssignmentHistory.findFirst({
      where: { cardId: event.cardId, createdAt: { lte: occurredAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { action: true, householdId: true, memberId: true },
    });
    if (history) {
      if (history.action === 'cancelled') return 'CARD_NOT_ASSIGNED_AT_OCCURRENCE';
      if (history.householdId !== event.householdId || history.memberId !== event.memberId)
        return 'CARD_OWNER_MISMATCH';
      return null;
    }
    const active = await tx.cardAssignment.findFirst({
      where: {
        cardId: event.cardId,
        householdId: event.householdId,
        memberId: event.memberId,
        assignedAt: { lte: occurredAt },
      },
      select: { id: true },
    });
    return active ? null : 'CARD_OWNER_NOT_VERIFIED_AT_OCCURRENCE';
  }

  private async updateProjection(
    tx: Prisma.TransactionClient,
    event: EdgeLedgerPayload,
  ): Promise<void> {
    const current = await tx.cardBalanceProjection.findUnique({ where: { cardId: event.cardId } });
    const localSequence = BigInt(event.localSequence);
    let balanceRial = current?.balanceRial ?? null;
    const lastConfirmedSnapshotAt = current?.lastConfirmedSnapshotAt ?? null;
    let lastAppliedEventId = current?.lastAppliedEventId ?? null;
    let lastSourceInstanceId = current?.lastSourceInstanceId ?? null;
    let lastAppliedLocalSequence = current?.lastAppliedLocalSequence ?? null;
    let freshness: 'fresh' | 'pending_sync' | 'stale' | 'unknown' = current?.freshness ?? 'unknown';
    let pendingTransactionCount = current?.pendingTransactionCount ?? 0;
    let reconciliationDifferenceRial = current?.reconciliationDifferenceRial ?? null;
    const isSameSource = lastSourceInstanceId === event.sourceInstanceId;
    const isOutOfOrder =
      isSameSource &&
      lastAppliedLocalSequence !== null &&
      localSequence <= lastAppliedLocalSequence;
    const isCoveredByPhysicalSnapshot =
      current?.lastSnapshotSourceInstanceId === event.sourceInstanceId &&
      current.lastSnapshotLocalSequence !== null &&
      current.lastSnapshotLocalSequence !== undefined &&
      localSequence <= current.lastSnapshotLocalSequence;

    if (isCoveredByPhysicalSnapshot) {
      return;
    } else if (isOutOfOrder) {
      freshness = 'stale';
    } else {
      lastAppliedEventId = event.eventId;
      lastSourceInstanceId = event.sourceInstanceId;
      lastAppliedLocalSequence = localSequence;
      if (event.balanceAfterRial === null) {
        freshness = 'pending_sync';
        pendingTransactionCount += 1;
      } else {
        const reported = BigInt(event.balanceAfterRial);
        const expected =
          current?.balanceRial !== null && current?.balanceRial !== undefined
            ? current.balanceRial + BigInt(event.amountRial)
            : null;
        reconciliationDifferenceRial = expected === null ? null : reported - expected;
        balanceRial = reported;
        pendingTransactionCount = 0;
        freshness =
          reconciliationDifferenceRial !== null && reconciliationDifferenceRial !== 0n
            ? 'stale'
            : current?.freshness === 'fresh'
              ? 'fresh'
              : 'stale';
      }
    }

    await tx.cardBalanceProjection.upsert({
      where: { cardId: event.cardId },
      create: {
        cardId: event.cardId,
        balanceRial,
        lastConfirmedSnapshotAt,
        lastAppliedEventId,
        lastSourceInstanceId,
        lastAppliedLocalSequence,
        freshness,
        pendingTransactionCount,
        reconciliationDifferenceRial,
      },
      update: {
        balanceRial,
        lastConfirmedSnapshotAt,
        lastAppliedEventId,
        lastSourceInstanceId,
        lastAppliedLocalSequence,
        freshness,
        pendingTransactionCount,
        reconciliationDifferenceRial,
        updatedAt: new Date(),
      },
    });
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function safeNumber(value: bigint | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function reconciliationResult(
  row: {
    snapshotId: string;
    cardId: string;
    balanceRial: bigint;
    differenceRial: bigint | null;
    freshness: BalanceFreshness;
    observedAt: Date;
  },
  duplicate: boolean,
) {
  return {
    snapshotId: row.snapshotId,
    cardId: row.cardId,
    balanceRial: safeNumber(row.balanceRial),
    differenceRial: safeNumber(row.differenceRial),
    freshness: row.freshness,
    observedAt: row.observedAt.toISOString(),
    duplicate,
  };
}

function encodeCursor(occurredAt: Date, id: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(value: string): { occurredAt: Date; id: string } {
  try {
    const [time, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    const occurredAt = new Date(time ?? '');
    if (!Number.isFinite(occurredAt.getTime()) || !id) throw new Error('invalid cursor');
    return { occurredAt, id };
  } catch {
    throw new ConflictException('Transaction history cursor is invalid.');
  }
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
