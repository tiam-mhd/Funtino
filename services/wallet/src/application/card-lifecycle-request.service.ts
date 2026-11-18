import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { Prisma } from '../../generated/prisma/index.js';
import { BRANCH_SCOPE_VALIDATOR, type BranchScopeValidator } from './ports/branch-scope-validator.port.js';
import { CardInventoryService } from './card-inventory.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

type LifecycleAction = 'lost' | 'replacement';
type LifecycleStatus = 'requested' | 'in_review' | 'approved' | 'rejected' | 'completed';
type LifecycleRecord = {
  id: string;
  cardId: string;
  replacementCardId: string | null;
  householdId: string;
  memberId: string | null;
  action: LifecycleAction;
  status: LifecycleStatus;
  reason: string;
  createdAt: Date;
};
type LifecycleView = ReturnType<typeof view>;

@Injectable()
export class CardLifecycleRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardInventory: CardInventoryService,
    @Inject(BRANCH_SCOPE_VALIDATOR) private readonly branchScope: BranchScopeValidator,
  ) {}

  async createRequest(input: {
    householdId: string;
    cardId: string;
    action: LifecycleAction;
    reason: string;
    requesterId: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    const requestHash = hash({
      householdId: input.householdId,
      cardId: input.cardId,
      action: input.action,
      reason: input.reason,
    });
    const existing = await this.prisma.cardLifecycleRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash.trim() !== requestHash)
        throw new ConflictException('Idempotency key conflicts with a different card request.');
      return { ...view(existing), duplicate: true };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.cardAssignment.findFirst({
          where: { cardId: input.cardId, householdId: input.householdId },
          include: { card: { select: { status: true, verificationStatus: true } } },
        });
        if (!assignment) throw new NotFoundException('Active card assignment not found.');
        if (assignment.card.status !== 'assigned' || assignment.card.verificationStatus !== 'verified')
          throw new ConflictException('Only a verified active card can have a lifecycle request.');
        const existingOpenRequest = await tx.cardLifecycleRequest.findFirst({
          where: {
            cardId: input.cardId,
            householdId: input.householdId,
            status: { in: ['requested', 'in_review', 'approved'] },
          },
        });
        if (existingOpenRequest)
          throw new ConflictException('An open lifecycle request already exists for this card.');

        const requestId = randomUUID();
        const record = await tx.cardLifecycleRequest.create({
          data: {
            id: requestId,
            cardId: input.cardId,
            organizationId: assignment.organizationId,
            branchId: assignment.branchId,
            householdId: input.householdId,
            memberId: assignment.memberId,
            action: input.action,
            status: 'requested',
            reason: input.reason,
            requestHash,
            idempotencyKey: input.idempotencyKey,
            requesterId: input.requesterId,
            correlationId: input.correlationId,
          },
        });
        const after = view(record);
        await tx.cardLifecycleRequestHistory.create({
          data: {
            id: randomUUID(),
            requestId,
            actorUserId: input.requesterId,
            actorType: 'customer',
            action: 'requested',
            status: 'requested',
            reason: input.reason,
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            commandHash: requestHash,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        await this.writeLifecycleEvent(tx, record, input.correlationId);
        return { ...after, duplicate: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const duplicate = await this.prisma.cardLifecycleRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (duplicate?.requestHash.trim() === requestHash) return { ...view(duplicate), duplicate: true };
      throw new ConflictException('Idempotency key conflicts with a different card request.');
    }
  }

  async listForHousehold(householdId: string, cardId: string) {
    const requests = await this.prisma.cardLifecycleRequest.findMany({
      where: { householdId, cardId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return requests.map(view);
  }

  async listForBranch(input: {
    organizationId: string;
    branchId: string;
    status?: LifecycleStatus;
    cursor?: string;
    pageSize: number;
  }) {
    await this.branchScope.assertActiveBranch(input.organizationId, input.branchId);
    const rows = await this.prisma.cardLifecycleRequest.findMany({
      where: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        ...(input.status ? { status: input.status } : {}),
      },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.pageSize + 1,
      include: { card: { select: { externalCardId: true } } },
    });
    const hasNext = rows.length > input.pageSize;
    const page = rows.slice(0, input.pageSize);
    return {
      items: page.map((row) => ({
        ...view(row),
        organizationId: row.organizationId,
        branchId: row.branchId,
        maskedIdentifier: maskIdentifier(row.card.externalCardId),
      })),
      nextCursor: hasNext ? page.at(-1)?.id ?? null : null,
    };
  }

  async transitionRequest(input: {
    organizationId: string;
    branchId: string;
    requestId: string;
    status: Exclude<LifecycleStatus, 'requested'>;
    reason: string;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    await this.branchScope.assertActiveBranch(input.organizationId, input.branchId);
    const current = await this.prisma.cardLifecycleRequest.findFirst({
      where: {
        id: input.requestId,
        organizationId: input.organizationId,
        branchId: input.branchId,
      },
    });
    if (!current) throw new NotFoundException('Card lifecycle request not found in branch scope.');

    let replacementCardId: string | null = null;
    if (input.status === 'completed' && current.action === 'replacement') {
      const replacement = await this.prisma.cardAssignment.findFirst({
        where: {
          householdId: current.householdId,
          branchId: current.branchId,
          memberId: current.memberId,
          cardId: { not: current.cardId },
          card: { status: 'assigned', verificationStatus: 'verified' },
        },
        select: { cardId: true },
      });
      if (!replacement)
        throw new ConflictException('A verified replacement card must be assigned to the same household member first.');
      replacementCardId = replacement.cardId;
    }

    const commandHash = hash({
      organizationId: input.organizationId,
      branchId: input.branchId,
      requestId: input.requestId,
      status: input.status,
      reason: input.reason,
    });
    const duplicate = await this.prisma.cardLifecycleRequestHistory.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (duplicate) {
      if (duplicate.requestId !== input.requestId || duplicate.commandHash.trim() !== commandHash)
        throw new ConflictException('Idempotency key conflicts with a different card request action.');
      return { ...(duplicate.after as unknown as LifecycleView), duplicate: true };
    }
    if (!isTransitionAllowed(current.status, input.status))
      throw new ConflictException('Card lifecycle request transition is not allowed.');

    // Approval blocks the old physical card first; a failed concurrent update leaves it safely blocked.
    if (input.status === 'approved') {
      const card = await this.cardInventory.getCard(input.organizationId, input.branchId, current.cardId);
      if (card.status === 'assigned') {
        await this.cardInventory.changeStatus(
          {
            organizationId: input.organizationId,
            branchId: input.branchId,
            cardId: current.cardId,
            expectedVersion: card.version,
            status: 'blocked',
            reason: input.reason,
          },
          {
            callerService: 'api-gateway',
            actorUserId: input.actorUserId,
            correlationId: input.correlationId,
            idempotencyKey: current.id,
          },
        );
      } else if (card.status !== 'blocked' && card.status !== 'retired') {
        throw new ConflictException('The card state must be reviewed before approving this request.');
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const changed = await tx.cardLifecycleRequest.updateMany({
          where: { id: current.id, branchId: input.branchId, status: current.status },
          data: { status: input.status, ...(replacementCardId ? { replacementCardId } : {}) },
        });
        if (changed.count !== 1)
          throw new ConflictException('Card lifecycle request changed concurrently; refresh it.');
        const updated = await tx.cardLifecycleRequest.findUniqueOrThrow({ where: { id: current.id } });
        const before = view(current);
        const after = view(updated);
        await tx.cardLifecycleRequestHistory.create({
          data: {
            id: randomUUID(),
            requestId: current.id,
            actorUserId: input.actorUserId,
            actorType: 'operations',
            action: input.status,
            status: input.status,
            reason: input.reason,
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            commandHash,
            before: before as unknown as Prisma.InputJsonValue,
            after: after as unknown as Prisma.InputJsonValue,
          },
        });
        await this.writeLifecycleEvent(tx, updated, input.correlationId);
        return { ...after, duplicate: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const replay = await this.prisma.cardLifecycleRequestHistory.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay?.requestId === input.requestId && replay.commandHash.trim() === commandHash)
        return { ...(replay.after as unknown as LifecycleView), duplicate: true };
      throw new ConflictException('Idempotency key conflicts with a different card request action.');
    }
  }

  private async writeLifecycleEvent(
    tx: Prisma.TransactionClient,
    record: {
      id: string;
      cardId: string;
      householdId: string;
      branchId: string;
      memberId: string | null;
      action: LifecycleAction;
      status: LifecycleStatus;
    },
    correlationId: string,
  ) {
    const envelope = createEventEnvelope({
      eventType: eventTypes.walletCardLifecycleChanged,
      sourceId: 'wallet',
      aggregateId: record.cardId,
      branchId: record.branchId,
      correlationId,
      payload: {
        requestId: record.id,
        cardId: record.cardId,
        householdId: record.householdId,
        branchId: record.branchId,
        memberId: record.memberId,
        action: record.action,
        status: record.status,
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
  }
}

function view(record: LifecycleRecord) {
  return {
    id: record.id,
    cardId: record.cardId,
    replacementCardId: record.replacementCardId,
    householdId: record.householdId,
    memberId: record.memberId,
    action: record.action,
    status: record.status,
    reason: record.reason,
    createdAt: record.createdAt.toISOString(),
  };
}

function isTransitionAllowed(current: LifecycleStatus, next: LifecycleStatus) {
  return (
    (current === 'requested' && (next === 'in_review' || next === 'rejected')) ||
    (current === 'in_review' && (next === 'approved' || next === 'rejected')) ||
    (current === 'approved' && next === 'completed')
  );
}

function maskIdentifier(value: string) {
  return value.length <= 4 ? '••••' : `•••• ${value.slice(-4)}`;
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
