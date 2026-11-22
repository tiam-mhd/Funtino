import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

export type CardBalanceLookupAudience =
  | { type: 'customer'; householdIds: string[] }
  | { type: 'operations'; organizationId: string; branchId: string };

export type CardBalanceLookupResult =
  | { status: 'available'; balanceRial: number }
  | { status: 'pending' | 'unavailable' };

@Injectable()
export class CardBalanceLookupService {
  constructor(private readonly prisma: PrismaService) {}

  lookup(input: { cardUidHash: string; audience: CardBalanceLookupAudience }) {
    const scope =
      input.audience.type === 'customer'
        ? { householdId: { in: input.audience.householdIds } }
        : {
            organizationId: input.audience.organizationId,
            branchId: input.audience.branchId,
          };
    const cardScope =
      input.audience.type === 'operations'
        ? {
            organizationId: input.audience.organizationId,
            branchId: input.audience.branchId,
          }
        : {};

    return this.prisma.$transaction(
      async (tx): Promise<CardBalanceLookupResult> => {
        const assignment = await tx.cardAssignment.findFirst({
          where: {
            ...scope,
            card: {
              is: {
                cardUidHash: input.cardUidHash.toLowerCase(),
                status: 'assigned',
                verificationStatus: 'verified',
                ...cardScope,
              },
            },
          },
          select: {
            cardId: true,
            card: { select: { balanceProjection: true } },
          },
        });
        if (!assignment) return { status: 'unavailable' };

        const pendingTransactionCount = await tx.edgeEventInbox.count({
          where: { cardId: assignment.cardId, status: 'pending_review' },
        });
        const projection = assignment.card.balanceProjection;
        const balanceRial = safeRial(projection?.balanceRial ?? null);
        if (
          !projection ||
          projection.freshness !== 'fresh' ||
          projection.lastConfirmedSnapshotAt === null ||
          projection.pendingTransactionCount !== 0 ||
          pendingTransactionCount !== 0 ||
          (projection.reconciliationDifferenceRial !== null &&
            projection.reconciliationDifferenceRial !== 0n) ||
          balanceRial === null
        ) {
          return { status: 'pending' };
        }

        return { status: 'available', balanceRial };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

function safeRial(value: bigint | null): number | null {
  if (value === null || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}
