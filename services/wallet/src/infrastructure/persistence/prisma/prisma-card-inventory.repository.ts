import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import {
  Prisma,
  type CardAssignment as PrismaCardAssignment,
  type CardInventory as PrismaCardInventory,
} from '../../../../generated/prisma/index.js';
import type {
  CardCommandMeta,
  CardInventoryPage,
  CardInventoryRepository,
  ChangeCardStatusCommand,
  AssignCardCommand,
  TransferCardAssignmentCommand,
  CancelCardAssignmentCommand,
  ListCardsQuery,
  RegisterCardCommand,
} from '../../../application/ports/card-inventory.repository.js';
import {
  cardAuditSnapshot,
  isCardStatusTransitionAllowed,
  maskExternalCardId,
  toCardInventoryView,
  type CardAssignmentView,
  type CardInventoryRecord,
  type CardInventoryStatus,
} from '../../../domain/card-inventory/card-inventory.js';
import { PrismaService } from './prisma.service.js';

type StoredResponse<T> = { result: T };

@Injectable()
export class PrismaCardInventoryRepository implements CardInventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findIdempotentMutation<T extends object>(
    operation: string,
    command: object,
    meta: CardCommandMeta,
  ): Promise<T | null> {
    const row = await this.prisma.idempotencyCommand.findUnique({
      where: {
        callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
      },
    });
    if (!row) return null;
    const requestHash = hash({ operation, command, actorUserId: meta.actorUserId });
    if (row.requestHash.trim() !== requestHash)
      throw new ConflictException('Idempotency-Key was already used for another command.');
    const stored = row.response as unknown as StoredResponse<T>;
    if (!stored || typeof stored !== 'object' || !('result' in stored))
      throw new ServiceUnavailableException('Stored idempotency result is invalid.');
    return stored.result;
  }

  registerCard(command: RegisterCardCommand, meta: CardCommandMeta) {
    return this.executeIdempotent('card.inventory.register', command, meta, async (tx) => {
      const id = randomUUID();
      const now = new Date();
      const row = await tx.cardInventory.create({
        data: {
          id,
          organizationId: command.organizationId,
          branchId: command.branchId,
          externalCardId: command.externalCardId,
          status: 'in_stock',
          verificationStatus: 'unknown',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      const result = toCardInventoryView(mapRecord(row));
      const after = cardAuditSnapshot(mapRecord(row));
      await this.writeHistory(tx, {
        cardId: row.id,
        action: 'registered',
        meta,
        reason: command.reason,
        before: null,
        after,
      });
      await this.writeOutbox(
        tx,
        createEventEnvelope({
          eventType: eventTypes.walletCardRegistered,
          sourceId: 'wallet',
          aggregateId: row.id,
          organizationId: row.organizationId,
          branchId: row.branchId,
          correlationId: meta.correlationId,
          payload: {
            cardId: row.id,
            status: 'in_stock',
            verificationStatus: 'unknown',
            version: row.version,
          },
        }),
      );
      return result;
    });
  }

  changeCardStatus(command: ChangeCardStatusCommand, meta: CardCommandMeta) {
    return this.executeIdempotent('card.inventory.change-status', command, meta, async (tx) => {
      const beforeRow = await tx.cardInventory.findFirst({
        where: {
          id: command.cardId,
          organizationId: command.organizationId,
          branchId: command.branchId,
        },
      });
      if (!beforeRow) throw new NotFoundException('Card inventory record not found.');
      if (beforeRow.version !== command.expectedVersion)
        throw new ConflictException('Card changed concurrently; reload before retrying.');
      if (!isCardStatusTransitionAllowed(beforeRow.status, command.status))
        throw new ConflictException('Card inventory status transition is not allowed.');
      if (beforeRow.status === command.status) return toCardInventoryView(mapRecord(beforeRow));
      if (command.status === 'in_stock') {
        if (beforeRow.verificationStatus !== 'verified') {
          throw new ConflictException('Only verified cards can return to assignable inventory.');
        }
        const assignment = await tx.cardAssignment.findUnique({ where: { cardId: beforeRow.id } });
        if (assignment) throw new ConflictException('An assigned card cannot return to stock.');
      }

      const updated = await tx.cardInventory.updateMany({
        where: {
          id: command.cardId,
          organizationId: command.organizationId,
          branchId: command.branchId,
          version: command.expectedVersion,
          status: beforeRow.status,
        },
        data: {
          status: command.status,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (!updated.count) throw new ConflictException('Card changed concurrently; reload it.');

      const afterRow = await tx.cardInventory.findUniqueOrThrow({ where: { id: command.cardId } });
      const before = cardAuditSnapshot(mapRecord(beforeRow));
      const after = cardAuditSnapshot(mapRecord(afterRow));
      await this.writeHistory(tx, {
        cardId: afterRow.id,
        action: 'status_changed',
        meta,
        reason: command.reason,
        before,
        after,
      });
      await this.writeOutbox(
        tx,
        createEventEnvelope({
          eventType: eventTypes.walletCardStatusChanged,
          sourceId: 'wallet',
          aggregateId: afterRow.id,
          organizationId: afterRow.organizationId,
          branchId: afterRow.branchId,
          correlationId: meta.correlationId,
          payload: {
            cardId: afterRow.id,
            previousStatus: beforeRow.status,
            status: afterRow.status,
            version: afterRow.version,
          },
        }),
      );
      return toCardInventoryView(mapRecord(afterRow));
    });
  }

  async listCards(query: ListCardsQuery): Promise<CardInventoryPage> {
    const rows = await this.prisma.cardInventory.findMany({
      where: {
        organizationId: query.organizationId,
        branchId: query.branchId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.pageSize + 1,
    });
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize).map((row) => toCardInventoryView(mapRecord(row)));
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async getCard(organizationId: string, branchId: string, cardId: string) {
    const row = await this.prisma.cardInventory.findFirst({
      where: { id: cardId, organizationId, branchId },
    });
    if (!row) throw new NotFoundException('Card inventory record not found.');
    return toCardInventoryView(mapRecord(row));
  }

  assignCard(command: AssignCardCommand, meta: CardCommandMeta): Promise<CardAssignmentView> {
    return this.executeIdempotent('card.assignment.assign', command, meta, async (tx) => {
      const card = await tx.cardInventory.findFirst({
        where: {
          id: command.cardId,
          organizationId: command.organizationId,
          branchId: command.branchId,
        },
      });
      if (!card) throw new NotFoundException('Card inventory record not found.');
      if (card.status !== 'in_stock' || card.verificationStatus !== 'verified') {
        throw new ConflictException('Only verified cards in stock can be assigned.');
      }

      const assignmentId = randomUUID();
      const assignedAt = new Date();
      await tx.cardAssignment.create({
        data: {
          id: assignmentId,
          cardId: card.id,
          organizationId: card.organizationId,
          branchId: card.branchId,
          householdId: command.householdId,
          assignedAt,
        },
      });
      const changed = await tx.cardInventory.updateMany({
        where: {
          id: card.id,
          organizationId: command.organizationId,
          branchId: command.branchId,
          status: 'in_stock',
          verificationStatus: 'verified',
          version: card.version,
        },
        data: { status: 'assigned', version: { increment: 1 }, updatedAt: assignedAt },
      });
      if (!changed.count)
        throw new ConflictException('Card changed concurrently; reload before retrying.');

      const updatedCard = await tx.cardInventory.findUniqueOrThrow({ where: { id: card.id } });
      const assignment = await tx.cardAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: { card: true },
      });
      await this.writeHistory(tx, {
        cardId: card.id,
        action: 'status_changed',
        meta,
        reason: command.reason,
        before: cardAuditSnapshot(mapRecord(card)),
        after: cardAuditSnapshot(mapRecord(updatedCard)),
      });
      await this.writeAssignmentHistory(tx, {
        assignmentId,
        cardId: card.id,
        organizationId: card.organizationId,
        branchId: card.branchId,
        householdId: command.householdId,
        previousHouseholdId: null,
        action: 'assigned',
        meta,
        reason: command.reason,
      });
      await this.writeCardStatusChanged(tx, card, updatedCard, meta);
      await this.writeAssignmentChanged(tx, {
        assignmentId,
        cardId: card.id,
        organizationId: card.organizationId,
        branchId: card.branchId,
        householdId: command.householdId,
        previousHouseholdId: null,
        action: 'assigned',
        correlationId: meta.correlationId,
      });
      return mapAssignment(assignment);
    });
  }

  async getAssignment(assignmentId: string): Promise<CardAssignmentView> {
    const assignment = await this.prisma.cardAssignment.findUnique({
      where: { id: assignmentId },
      include: { card: true },
    });
    if (!assignment) throw new NotFoundException('Active card assignment not found.');
    return mapAssignment(assignment);
  }

  async listBranchAssignments(query: {
    organizationId: string;
    branchId: string;
    cursor?: string;
    pageSize: number;
  }) {
    const rows = await this.prisma.cardAssignment.findMany({
      where: {
        organizationId: query.organizationId,
        branchId: query.branchId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: { card: true },
      orderBy: { id: 'asc' },
      take: query.pageSize + 1,
    });
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize).map(mapAssignment);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async listHouseholdAssignments(query: {
    householdId: string;
    cursor?: string;
    pageSize: number;
  }): Promise<{ items: CardAssignmentView[]; nextCursor: string | null }> {
    const rows = await this.prisma.cardAssignment.findMany({
      where: {
        householdId: query.householdId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: { card: true },
      orderBy: { id: 'asc' },
      take: query.pageSize + 1,
    });
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize).map(mapAssignment);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  transferAssignment(
    command: TransferCardAssignmentCommand,
    meta: CardCommandMeta,
  ): Promise<CardAssignmentView> {
    return this.executeIdempotent('card.assignment.transfer', command, meta, async (tx) => {
      const current = await tx.cardAssignment.findUnique({
        where: { id: command.assignmentId },
        include: { card: true },
      });
      if (!current) throw new NotFoundException('Active card assignment not found.');
      if (current.householdId === command.householdId) {
        throw new ConflictException('Card is already assigned to this household at this branch.');
      }
      if (current.card.status !== 'assigned' || current.card.verificationStatus !== 'verified') {
        throw new ConflictException('Only a verified active card can be transferred.');
      }
      const removed = await tx.cardAssignment.deleteMany({
        where: {
          id: current.id,
          cardId: current.cardId,
          householdId: current.householdId,
          branchId: current.branchId,
        },
      });
      if (!removed.count)
        throw new ConflictException('Assignment changed concurrently; reload it.');
      const assignment = await tx.cardAssignment.create({
        data: {
          id: randomUUID(),
          cardId: current.cardId,
          organizationId: current.organizationId,
          branchId: current.branchId,
          householdId: command.householdId,
          assignedAt: new Date(),
        },
        include: { card: true },
      });
      await this.writeAssignmentHistory(tx, {
        assignmentId: assignment.id,
        cardId: current.cardId,
        organizationId: current.organizationId,
        branchId: current.branchId,
        householdId: command.householdId,
        previousHouseholdId: current.householdId,
        action: 'transferred',
        meta,
        reason: command.reason,
      });
      await this.writeAssignmentChanged(tx, {
        assignmentId: assignment.id,
        cardId: current.cardId,
        organizationId: current.organizationId,
        branchId: current.branchId,
        householdId: command.householdId,
        previousHouseholdId: current.householdId,
        action: 'transferred',
        correlationId: meta.correlationId,
      });
      return mapAssignment(assignment);
    });
  }

  cancelAssignment(
    command: CancelCardAssignmentCommand,
    meta: CardCommandMeta,
  ): Promise<{ assignmentId: string; status: 'cancelled' }> {
    return this.executeIdempotent('card.assignment.cancel', command, meta, async (tx) => {
      const current = await tx.cardAssignment.findUnique({
        where: { id: command.assignmentId },
        include: { card: true },
      });
      if (!current) throw new NotFoundException('Active card assignment not found.');
      const removed = await tx.cardAssignment.deleteMany({
        where: { id: current.id, cardId: current.cardId, householdId: current.householdId },
      });
      if (!removed.count)
        throw new ConflictException('Assignment changed concurrently; reload it.');

      let afterCard = current.card;
      if (current.card.status === 'assigned') {
        const nextStatus = current.card.verificationStatus === 'verified' ? 'in_stock' : 'blocked';
        const changed = await tx.cardInventory.updateMany({
          where: { id: current.cardId, status: 'assigned', version: current.card.version },
          data: { status: nextStatus, version: { increment: 1 }, updatedAt: new Date() },
        });
        if (!changed.count) throw new ConflictException('Card changed concurrently; reload it.');
        afterCard = await tx.cardInventory.findUniqueOrThrow({ where: { id: current.cardId } });
        await this.writeHistory(tx, {
          cardId: current.cardId,
          action: 'status_changed',
          meta,
          reason: command.reason,
          before: cardAuditSnapshot(mapRecord(current.card)),
          after: cardAuditSnapshot(mapRecord(afterCard)),
        });
        await this.writeCardStatusChanged(tx, current.card, afterCard, meta);
      }
      await this.writeAssignmentHistory(tx, {
        assignmentId: current.id,
        cardId: current.cardId,
        organizationId: current.organizationId,
        branchId: current.branchId,
        householdId: current.householdId,
        previousHouseholdId: null,
        action: 'cancelled',
        meta,
        reason: command.reason,
      });
      await this.writeAssignmentChanged(tx, {
        assignmentId: current.id,
        cardId: current.cardId,
        organizationId: current.organizationId,
        branchId: current.branchId,
        householdId: current.householdId,
        previousHouseholdId: null,
        action: 'cancelled',
        correlationId: meta.correlationId,
      });
      return { assignmentId: current.id, status: 'cancelled' as const };
    });
  }

  async isReady(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Wallet database is unavailable.');
    }
  }

  private async executeIdempotent<T extends object>(
    operation: string,
    command: object,
    meta: CardCommandMeta,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const existing = await this.findIdempotentMutation<T>(operation, command, meta);
    if (existing) return existing;
    const requestHash = hash({ operation, command, actorUserId: meta.actorUserId });

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyCommand.create({
          data: {
            callerService: meta.callerService,
            key: meta.idempotencyKey,
            requestHash,
            response: { result: {} },
          },
        });
        const result = await work(tx);
        await tx.idempotencyCommand.update({
          where: {
            callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
          },
          data: { response: { result } as Prisma.InputJsonValue },
        });
        return result;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay = await this.findIdempotentMutation<T>(operation, command, meta);
      if (replay) return replay;
      throw new ConflictException('Card identity or idempotency key is already in use.');
    }
  }

  private async writeHistory(
    tx: Prisma.TransactionClient,
    input: {
      cardId: string;
      action: 'registered' | 'status_changed';
      meta: CardCommandMeta;
      reason: string | null;
      before: object | null;
      after: object;
    },
  ): Promise<void> {
    await tx.cardInventoryHistory.create({
      data: {
        id: randomUUID(),
        cardId: input.cardId,
        action: input.action,
        actorUserId: input.meta.actorUserId,
        callerService: input.meta.callerService,
        correlationId: input.meta.correlationId,
        reason: input.reason,
        before: input.before === null ? Prisma.DbNull : (input.before as Prisma.InputJsonValue),
        after: input.after as Prisma.InputJsonValue,
      },
    });
  }

  private async writeOutbox(
    tx: Prisma.TransactionClient,
    envelope: ReturnType<typeof createEventEnvelope>,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: envelope.eventId,
        eventType: envelope.eventType,
        aggregateId: envelope.aggregateId,
        envelope: envelope as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async writeAssignmentHistory(
    tx: Prisma.TransactionClient,
    input: {
      assignmentId: string;
      cardId: string;
      organizationId: string;
      branchId: string;
      householdId: string;
      previousHouseholdId: string | null;
      action: 'assigned' | 'transferred' | 'cancelled';
      meta: CardCommandMeta;
      reason: string;
    },
  ) {
    await tx.cardAssignmentHistory.create({
      data: {
        id: randomUUID(),
        assignmentId: input.assignmentId,
        cardId: input.cardId,
        organizationId: input.organizationId,
        branchId: input.branchId,
        householdId: input.householdId,
        previousHouseholdId: input.previousHouseholdId,
        action: input.action,
        actorUserId: input.meta.actorUserId,
        callerService: input.meta.callerService,
        correlationId: input.meta.correlationId,
        reason: input.reason,
      },
    });
  }

  private async writeAssignmentChanged(
    tx: Prisma.TransactionClient,
    input: {
      assignmentId: string;
      cardId: string;
      organizationId: string;
      branchId: string;
      householdId: string;
      previousHouseholdId: string | null;
      action: 'assigned' | 'transferred' | 'cancelled';
      correlationId: string;
    },
  ) {
    await this.writeOutbox(
      tx,
      createEventEnvelope({
        eventType: eventTypes.walletCardAssignmentChanged,
        sourceId: 'wallet',
        aggregateId: input.cardId,
        organizationId: input.organizationId,
        branchId: input.branchId,
        correlationId: input.correlationId,
        payload: {
          assignmentId: input.assignmentId,
          cardId: input.cardId,
          householdId: input.householdId,
          previousHouseholdId: input.previousHouseholdId,
          action: input.action,
        },
      }),
    );
  }

  private async writeCardStatusChanged(
    tx: Prisma.TransactionClient,
    before: PrismaCardInventory,
    after: PrismaCardInventory,
    meta: CardCommandMeta,
  ) {
    await this.writeOutbox(
      tx,
      createEventEnvelope({
        eventType: eventTypes.walletCardStatusChanged,
        sourceId: 'wallet',
        aggregateId: after.id,
        organizationId: after.organizationId,
        branchId: after.branchId,
        correlationId: meta.correlationId,
        payload: {
          cardId: after.id,
          previousStatus: before.status,
          status: after.status,
          version: after.version,
        },
      }),
    );
  }
}

function mapRecord(row: PrismaCardInventory): CardInventoryRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    externalCardId: row.externalCardId,
    status: row.status as CardInventoryStatus,
    verificationStatus: row.verificationStatus,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAssignment(
  row: PrismaCardAssignment & { card: PrismaCardInventory },
): CardAssignmentView {
  return {
    id: row.id,
    cardId: row.cardId,
    organizationId: row.organizationId,
    branchId: row.branchId,
    householdId: row.householdId,
    maskedIdentifier: maskExternalCardId(row.card.externalCardId),
    status: row.card.status,
    verificationStatus: row.card.verificationStatus,
    assignedAt: row.assignedAt.toISOString(),
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
