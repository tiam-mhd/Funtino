import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { CustomerHouseholdService } from './customer-household.service.js';
import { CustomerProfileService, type CustomerProfileUpdate } from './customer-profile.service.js';

@Injectable()
export class EdgeHouseholdOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: CustomerHouseholdService,
    private readonly profiles: CustomerProfileService,
  ) {}

  async searchCustomers(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    query: string;
    cursor?: string;
    pageSize: number;
  }) {
    const needle = input.query.trim().toLocaleLowerCase('fa-IR');
    const exactCustomerId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.query.trim(),
      )
        ? input.query.trim()
        : null;
    const profiles = await this.prisma.customerProfile.findMany({
      where: {
        AND: [
          {
            OR: [
              ...(exactCustomerId ? [{ userId: exactCustomerId }] : []),
              { firstName: { contains: needle, mode: 'insensitive' } },
              { lastName: { contains: needle, mode: 'insensitive' } },
            ],
          },
          ...(input.cursor ? [{ userId: { gt: input.cursor } }] : []),
        ],
      },
      orderBy: { userId: 'asc' },
      take: input.pageSize + 1,
      select: { userId: true, firstName: true, lastName: true, version: true },
    });
    const hasMore = profiles.length > input.pageSize;
    const pageProfiles = profiles.slice(0, input.pageSize);
    const customerIds = pageProfiles.map((profile) => profile.userId);
    const households = customerIds.length
      ? await this.prisma.household.findMany({
          where: {
            status: 'active',
            OR: [
              { ownerUserId: { in: customerIds } },
              {
                members: {
                  some: {
                    status: 'active',
                    familyPerson: { is: { accountUserId: { in: customerIds } } },
                  },
                },
              },
            ],
          },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            ownerUserId: true,
            members: {
              where: { status: 'active' },
              select: {
                id: true,
                displayName: true,
                familyPerson: { select: { accountUserId: true } },
              },
            },
          },
        })
      : [];
    const householdByCustomer = new Map<
      string,
      { householdId: string; memberId: string | null; memberName: string | null }
    >();
    for (const household of households) {
      if (customerIds.some((id) => id.toLowerCase() === household.ownerUserId.toLowerCase())) {
        householdByCustomer.set(household.ownerUserId.toLowerCase(), {
          householdId: household.id,
          memberId: null,
          memberName: null,
        });
      }
      for (const member of household.members) {
        const userId = member.familyPerson?.accountUserId;
        if (userId && customerIds.some((id) => id.toLowerCase() === userId.toLowerCase())) {
          const key = userId.toLowerCase();
          if (!householdByCustomer.has(key)) {
            householdByCustomer.set(key, {
              householdId: household.id,
              memberId: member.id,
              memberName: member.displayName,
            });
          }
        }
      }
    }
    const items = pageProfiles.flatMap((profile) => {
      const household = householdByCustomer.get(profile.userId.toLowerCase());
      if (!household) return [];
      const name = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
      return [
        {
          customerId: profile.userId,
          displayName: name || household.memberName || 'بدون نام ثبت‌شده',
          maskedPhone: null,
          householdId: household.householdId,
          memberId: household.memberId,
          recordVersion: profile.version,
        },
      ];
    });
    await this.audit(input, 'customer.edge.lookup', 'customer_search', input.branchId, {
      returnedCount: items.length,
      queryHash: safeHash(input.query.trim()),
    });
    return {
      items,
      nextCursor: hasMore ? (pageProfiles.at(-1)?.userId ?? null) : null,
    };
  }

  async getCustomerProfile(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    customerId: string;
    householdIds: string[];
  }) {
    const membership = await this.prisma.household.findFirst({
      where: {
        id: { in: input.householdIds },
        status: 'active',
        OR: [
          { ownerUserId: input.customerId },
          {
            members: {
              some: {
                status: 'active',
                familyPerson: { is: { accountUserId: input.customerId } },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Customer is not available in this branch.');
    const profile = await this.prisma.customerProfile.findUnique({
      where: { userId: input.customerId },
    });
    if (!profile) throw new NotFoundException('Customer profile was not found.');
    await this.audit(input, 'customer.edge.profile.read', 'customer_profile', input.customerId, {
      branchId: input.branchId,
      householdId: membership.id,
    });
    return {
      customerId: profile.userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      birthDate: profile.birthDate?.toISOString().slice(0, 10) ?? null,
      gender: profile.gender,
      city: profile.city,
      avatarPreset: profile.avatarPreset,
      hasUploadedAvatar: Boolean(profile.avatarData),
      profileCompleted: Boolean(profile.profileCompletedAt),
      recordVersion: profile.version,
    };
  }

  async getHousehold(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    householdId: string;
  }) {
    const household = await this.prisma.household.findFirst({
      where: { id: input.householdId, status: 'active' },
      include: {
        members: {
          where: { status: 'active' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!household) throw new NotFoundException('Household was not found.');
    await this.audit(input, 'customer.edge.household.read', 'household', household.id, {
      branchId: input.branchId,
      memberCount: household.members.length,
    });
    return {
      id: household.id,
      name: household.name,
      status: household.status,
      recordVersion: household.version,
      members: household.members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        relationship: member.relationship,
        birthDate: member.birthDate?.toISOString().slice(0, 10) ?? null,
        isDependent: member.isDependent,
        status: member.status,
        recordVersion: member.version,
      })),
    };
  }

  updateProfile(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    customerId: string;
    expectedVersion: number;
    idempotencyKey: string;
    householdIds: string[];
    profile: CustomerProfileUpdate;
  }) {
    return this.getCustomerProfile(input).then(async () => {
      const result = await this.profiles.update(input.customerId, input.profile, {
        callerService: 'device-integration',
        actorUserId: input.actorUserId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      });
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new ServiceUnavailableException('Customer profile update response is invalid.');
      const userId = (result as Record<string, unknown>).userId;
      const version = (result as Record<string, unknown>).version;
      if (
        userId !== input.customerId ||
        typeof version !== 'number' ||
        !Number.isSafeInteger(version)
      )
        throw new ServiceUnavailableException('Customer profile update response is invalid.');
      return { userId, version };
    });
  }

  updateHousehold(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    householdId: string;
    expectedVersion: number;
    name: string;
    idempotencyKey: string;
  }) {
    return this.households
      .updateHousehold(
        input.householdId,
        { name: input.name, expectedVersion: input.expectedVersion },
        {
          callerService: 'device-integration',
          actorUserId: input.actorUserId,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
        },
      )
      .then(({ id, version }) => ({ id, version }));
  }

  addMember(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    householdId: string;
    idempotencyKey: string;
    displayName: string;
    relationship: string;
    birthDate?: string | null;
    isDependent?: boolean;
  }) {
    return this.households
      .addMember(
        input.householdId,
        {
          displayName: input.displayName,
          relationship: input.relationship,
          birthDate: input.birthDate,
          isDependent: input.isDependent,
        },
        {
          callerService: 'device-integration',
          actorUserId: input.actorUserId,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
        },
      )
      .then(({ id, householdId, version }) => ({ id, householdId, version }));
  }

  private audit(
    input: { actorUserId: string; correlationId: string },
    action: string,
    resourceType: string,
    resourceId: string,
    after: Record<string, string | number | null>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: input.actorUserId,
        callerService: 'device-integration',
        action,
        resourceType,
        resourceId,
        correlationId: input.correlationId,
        after,
      },
    });
  }
}

function safeHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
