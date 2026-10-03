import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { Prisma, type Household as PrismaHousehold } from '../../generated/prisma/index.js';
import { randomUUID, createHash } from 'node:crypto';
import {
  isHouseholdEligibleForCard,
  normalizeHouseholdName,
  normalizeMemberText,
  type HouseholdStatus,
} from '../domain/household/household.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

export type HouseholdCommandMeta = {
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
  callerService: 'api-gateway';
};

export type CreateHouseholdInput = { ownerUserId: string; name: string };
export type CreateHouseholdMemberInput = {
  displayName: string;
  relationship: string;
  birthDate?: string | null;
  isDependent?: boolean;
};

type HouseholdDto = {
  id: string;
  name: string;
  status: HouseholdStatus;
  version: number;
  createdAt: string;
};

type MemberDto = {
  id: string;
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate: string | null;
  status: 'active' | 'archived';
  isDependent: boolean;
  version: number;
  createdAt: string;
};

type StoredResponse<T> = { result: T };

@Injectable()
export class CustomerHouseholdService {
  constructor(private readonly prisma: PrismaService) {}

  async createHousehold(
    input: CreateHouseholdInput,
    meta: HouseholdCommandMeta,
  ): Promise<HouseholdDto> {
    if (input.ownerUserId !== meta.actorUserId) {
      throw new ForbiddenException(
        'A customer can only create a household for their own identity.',
      );
    }
    let name: string;
    try {
      name = normalizeHouseholdName(input.name);
    } catch {
      throw new BadRequestException('Household name is invalid.');
    }
    const command = { ownerUserId: input.ownerUserId, name };
    return this.executeIdempotent('household.create', command, meta, async (tx) => {
      const now = new Date();
      const household = await tx.household.create({
        data: {
          id: randomUUID(),
          ownerUserId: input.ownerUserId,
          name,
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
          accesses: {
            create: {
              id: randomUUID(),
              userId: input.ownerUserId,
              role: 'owner',
              status: 'active',
              createdAt: now,
            },
          },
        },
      });
      const result = mapHousehold(household);
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.household.created',
          resourceType: 'household',
          resourceId: household.id,
          correlationId: meta.correlationId,
          after: {
            householdId: household.id,
            status: household.status,
            version: household.version,
          },
        },
      });
      const envelope = createEventEnvelope({
        eventType: eventTypes.householdCreated,
        sourceId: 'customer-household',
        aggregateId: household.id,
        correlationId: meta.correlationId,
        payload: { householdId: household.id, ownerUserId: input.ownerUserId },
      });
      await tx.outboxEvent.create({
        data: {
          id: envelope.eventId,
          eventType: envelope.eventType,
          aggregateId: household.id,
          envelope: envelope as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    });
  }

  async listHouseholdsForUser(userId: string) {
    const rows = await this.prisma.householdAccess.findMany({
      where: { userId, status: 'active', household: { status: 'active' } },
      include: {
        household: {
          include: {
            members: {
              where: { status: 'active' },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { householdId: 'asc' }],
    });
    return {
      items: rows.map(({ household }) => ({
        ...mapHousehold(household),
        members: household.members.map(mapMember),
      })),
    };
  }

  async validateHousehold(householdId: string) {
    const household = await this.prisma.household.findUnique({ where: { id: householdId } });
    if (!household) throw new NotFoundException('Household not found.');
    return {
      householdId: household.id,
      status: household.status,
      version: household.version,
      eligibleForCard: isHouseholdEligibleForCard(household.status),
    };
  }

  async addMember(
    householdId: string,
    input: CreateHouseholdMemberInput,
    meta: HouseholdCommandMeta,
  ): Promise<MemberDto> {
    let displayName: string;
    let relationship: string;
    try {
      displayName = normalizeMemberText(input.displayName, 80);
      relationship = normalizeMemberText(input.relationship, 40);
    } catch {
      throw new BadRequestException('Household member information is invalid.');
    }
    const birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
    if (birthDate && (!Number.isFinite(birthDate.getTime()) || birthDate.getTime() > Date.now())) {
      throw new BadRequestException('Birth date cannot be in the future.');
    }
    const command = {
      householdId,
      displayName,
      relationship,
      birthDate: input.birthDate ?? null,
      isDependent: input.isDependent ?? true,
    };
    return this.executeIdempotent('household.member.create', command, meta, async (tx) => {
      const access = await tx.householdAccess.findFirst({
        where: {
          householdId,
          userId: meta.actorUserId,
          status: 'active',
          role: 'owner',
          household: { status: 'active' },
        },
        select: { householdId: true },
      });
      if (!access) throw new NotFoundException('Household not found.');

      const now = new Date();
      const member = await tx.householdMember.create({
        data: {
          id: randomUUID(),
          householdId,
          displayName,
          relationship,
          birthDate,
          isDependent: input.isDependent ?? true,
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      const result = mapMember(member);
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.household.member.created',
          resourceType: 'household_member',
          resourceId: member.id,
          correlationId: meta.correlationId,
          after: {
            householdId,
            memberId: member.id,
            status: member.status,
            version: member.version,
          },
        },
      });
      const envelope = createEventEnvelope({
        eventType: eventTypes.householdMemberCreated,
        sourceId: 'customer-household',
        aggregateId: householdId,
        correlationId: meta.correlationId,
        payload: { householdId, memberId: member.id },
      });
      await tx.outboxEvent.create({
        data: {
          id: envelope.eventId,
          eventType: envelope.eventType,
          aggregateId: householdId,
          envelope: envelope as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    });
  }

  async isReady(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  private async executeIdempotent<T extends object>(
    operation: string,
    command: object,
    meta: HouseholdCommandMeta,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const requestHash = hash({ operation, command, actorUserId: meta.actorUserId });
    const replay = await this.findReplay<T>(meta, requestHash);
    if (replay) return replay;
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
      const duplicate = await this.findReplay<T>(meta, requestHash);
      if (duplicate) return duplicate;
      throw new ConflictException('Idempotency key is already in use for another request.');
    }
  }

  private async findReplay<T extends object>(
    meta: HouseholdCommandMeta,
    requestHash: string,
  ): Promise<T | null> {
    const row = await this.prisma.idempotencyCommand.findUnique({
      where: {
        callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
      },
    });
    if (!row) return null;
    if (row.requestHash.trim() !== requestHash) {
      throw new ConflictException('Idempotency key is already in use for another request.');
    }
    const response = row.response as unknown as StoredResponse<T>;
    if (!response || typeof response !== 'object' || !('result' in response)) {
      throw new ConflictException('Stored idempotency response is invalid.');
    }
    return response.result;
  }
}

function mapHousehold(value: PrismaHousehold): HouseholdDto {
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    version: value.version,
    createdAt: value.createdAt.toISOString(),
  };
}

function mapMember(value: {
  id: string;
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate: Date | null;
  status: 'active' | 'archived';
  isDependent: boolean;
  version: number;
  createdAt: Date;
}): MemberDto {
  return {
    id: value.id,
    householdId: value.householdId,
    displayName: value.displayName,
    relationship: value.relationship,
    birthDate: value.birthDate?.toISOString().slice(0, 10) ?? null,
    status: value.status,
    isDependent: value.isDependent,
    version: value.version,
    createdAt: value.createdAt.toISOString(),
  };
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

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
