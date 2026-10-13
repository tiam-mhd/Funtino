import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { Prisma, type Household as PrismaHousehold } from '../../generated/prisma/index.js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import {
  isHouseholdEligibleForCard,
  normalizeHouseholdName,
  normalizeMemberText,
  type HouseholdStatus,
} from '../domain/household/household.js';
import {
  deriveRelationshipPresentation,
  legacyRelationshipLabel,
  relationshipKindForInput,
  validateRelationshipGraph,
  type RelationshipEdge,
} from '../domain/family/family-graph.js';
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

export type AddFamilyMemberInput = {
  displayName: string;
  relativeMemberId?: string | 'viewer' | null;
  relationship: 'parent' | 'child' | 'spouse' | 'sibling' | 'guardian' | 'ward';
  basis: 'biological' | 'legal' | 'adoptive' | 'step' | 'partner' | 'unspecified';
  displayGender?: 'female' | 'male' | 'unspecified';
  birthDate?: string | null;
  isDependent: boolean;
  targetUserId?: string;
  targetPhoneHash?: string;
  createClaimLink?: boolean;
};
export type UpdateFamilyMemberInput = {
  expectedVersion: number;
  displayName?: string;
  displayGender?: 'female' | 'male' | 'unspecified' | null;
  birthDate?: string | null;
  relationshipId?: string;
  relativeMemberId?: string;
  relationship?: AddFamilyMemberInput['relationship'];
  basis?: AddFamilyMemberInput['basis'];
};

type FamilyInvitationDto = {
  id: string;
  householdId: string;
  memberId: string;
  kind: 'adult_account' | 'dependent_claim';
  status:
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'revoked'
    | 'expired'
    | 'claim_pending'
    | 'linked'
    | 'conflict_review';
  expiresAt: string | null;
  createdAt: string;
  shareToken?: string;
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
  status: 'active' | 'pending' | 'archived';
  isDependent: boolean;
  version: number;
  createdAt: string;
};

type StoredResponse<T> = { result: T };
type AccountLinkInvitation = Prisma.HouseholdInvitationGetPayload<{
  include: { member: { include: { familyPerson: true } } };
}>;

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

  async listFamilyForUser(userId: string, targetPhoneHash?: string) {
    const rows = await this.prisma.householdAccess.findMany({
      where: { userId, status: 'active', household: { status: 'active' } },
      include: {
        household: {
          include: {
            members: {
              where: { status: 'active' },
              include: { familyPerson: { select: { accountUserId: true } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
            relationships: true,
            invitations: {
              include: { member: { select: { displayName: true } } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 50,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { householdId: 'asc' }],
    });
    const inboxWhere = [
      { targetUserId: userId },
      { claimUserId: userId },
      ...(targetPhoneHash ? [{ targetPhoneHash }] : []),
    ];
    const invitations = await this.prisma.householdInvitation.findMany({
      where: {
        OR: inboxWhere,
      },
      include: {
        household: { select: { id: true, name: true } },
        member: { select: { id: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });

    return {
      items: rows.map(({ household, role }) => {
        const viewer = household.members.find(
          (member) => member.familyPerson?.accountUserId?.toLowerCase() === userId.toLowerCase(),
        );
        const activeMemberIds = new Set(household.members.map((member) => member.id));
        const activeRelationships = household.relationships.filter(
          (edge) => activeMemberIds.has(edge.fromMemberId) && activeMemberIds.has(edge.toMemberId),
        );
        const edges: RelationshipEdge[] = activeRelationships.map((edge) => ({
          fromMemberId: edge.fromMemberId,
          toMemberId: edge.toMemberId,
          kind: edge.kind,
          basis: edge.basis,
        }));
        const people = household.members.map((member) => ({
          id: member.id,
          gender: member.displayGender,
        }));
        return {
          ...mapHousehold(household),
          accessRole: role,
          canManage: role === 'owner' || role === 'guardian',
          viewerMemberId: viewer?.id ?? null,
          members: household.members.map((member) => {
            const presentation = deriveRelationshipPresentation(
              viewer?.id ?? null,
              member.id,
              people,
              edges,
            );
            return {
              ...mapMember(member),
              displayGender: member.displayGender,
              isAccountLinked: Boolean(member.familyPerson?.accountUserId),
              isViewer: member.id === viewer?.id,
              relationshipLabel: presentation.label,
              relationshipStatus: presentation.status,
            };
          }),
          relationships: activeRelationships.map((edge) => ({
            id: edge.id,
            fromMemberId: edge.fromMemberId,
            toMemberId: edge.toMemberId,
            kind: edge.kind,
            basis: edge.basis,
          })),
          invitations: household.invitations.map((invitation) => ({
            ...mapInvitation(invitation),
            memberName: invitation.member.displayName,
          })),
        };
      }),
      invitations: invitations.map((invitation) => ({
        ...mapInvitation(invitation),
        householdName: invitation.household.name,
        memberName: invitation.member.displayName,
      })),
    };
  }

  async listFamilyAuditHistory(householdId: string) {
    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { id: true },
    });
    if (!household) throw new NotFoundException('Household not found.');
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { startsWith: 'customer.family.' },
        OR: [
          { resourceType: 'household', resourceId: householdId },
          { after: { path: ['householdId'], equals: householdId } },
          { before: { path: ['householdId'], equals: householdId } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
      select: { action: true, createdAt: true },
    });
    return {
      items: rows.map((row) => ({ action: row.action, createdAt: row.createdAt.toISOString() })),
    };
  }

  async addFamilyMember(
    householdId: string,
    input: AddFamilyMemberInput,
    meta: HouseholdCommandMeta,
  ) {
    let displayName: string;
    try {
      displayName = normalizeMemberText(input.displayName, 80);
    } catch {
      throw new BadRequestException('Household member information is invalid.');
    }
    if (
      (input.targetUserId && input.targetPhoneHash) ||
      (input.targetUserId && input.targetUserId === meta.actorUserId) ||
      (input.targetPhoneHash && !/^[a-f0-9]{64}$/iu.test(input.targetPhoneHash))
    ) {
      throw new BadRequestException('Family invitation target is invalid.');
    }
    const birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
    if (birthDate && (!Number.isFinite(birthDate.getTime()) || birthDate.getTime() > Date.now())) {
      throw new BadRequestException('Birth date cannot be in the future.');
    }
    const command = {
      householdId,
      displayName,
      relativeMemberId: input.relativeMemberId ?? 'viewer',
      relationship: input.relationship,
      basis: input.basis,
      displayGender: input.displayGender ?? 'unspecified',
      birthDate: input.birthDate ?? null,
      isDependent: input.isDependent,
      targetUserId: input.targetUserId ?? null,
      targetPhoneHash: input.targetPhoneHash ?? null,
      createClaimLink: input.createClaimLink ?? false,
    };
    const shouldCreateInvitation = Boolean(
      input.targetUserId || input.targetPhoneHash || (input.isDependent && input.createClaimLink),
    );
    if (shouldCreateInvitation && !input.isDependent && command.relativeMemberId !== 'viewer') {
      throw new BadRequestException(
        'Adult account invitations must describe the inviter relationship.',
      );
    }
    const shareToken = shouldCreateInvitation ? randomBytes(32).toString('base64url') : null;
    const shareTokenHash = shareToken
      ? createHash('sha256').update(shareToken).digest('hex')
      : null;
    const execution = await this.executeIdempotentDetailed<{
      member: MemberDto;
      relationship: RelationshipEdge | null;
      invitation: Omit<FamilyInvitationDto, 'shareToken'> | null;
    }>('family.member.create', command, meta, async (tx) => {
      const access = await tx.householdAccess.findFirst({
        where: {
          householdId,
          userId: meta.actorUserId,
          status: 'active',
          role: { in: ['owner', 'guardian'] },
          household: { status: 'active' },
        },
        select: { role: true },
      });
      if (!access) throw new NotFoundException('Household not found.');
      if (access.role === 'guardian' && !input.isDependent) {
        throw new ForbiddenException('A guardian can only add a dependent member.');
      }

      if (input.targetUserId || input.targetPhoneHash) {
        const target = input.targetUserId
          ? { targetUserId: input.targetUserId }
          : { targetPhoneHash: input.targetPhoneHash };
        const existingInvitation = await tx.householdInvitation.findFirst({
          where: { householdId, status: 'pending', ...target },
          include: { member: true },
        });
        if (existingInvitation) {
          if (
            existingInvitation.expiresAt &&
            existingInvitation.expiresAt.getTime() <= Date.now()
          ) {
            const expiredCount = await tx.householdInvitation.updateMany({
              where: { id: existingInvitation.id, status: 'pending' },
              data: { status: 'expired' },
            });
            if (expiredCount.count !== 1)
              throw new ConflictException('Invitation state changed; reload and try again.');
            if (existingInvitation.member.status === 'pending') {
              await tx.householdMember.update({
                where: { id: existingInvitation.memberId },
                data: { status: 'archived', version: { increment: 1 }, updatedAt: new Date() },
              });
            }
            const expired = await tx.householdInvitation.findUniqueOrThrow({
              where: { id: existingInvitation.id },
            });
            await this.auditInvitationStatus(
              tx,
              expired,
              meta,
              'customer.family.invitation.expired',
            );
            await this.persistFamilyEvent(
              tx,
              eventTypes.familyInvitationChanged,
              householdId,
              meta.correlationId,
              {
                householdId,
                invitationId: existingInvitation.id,
                memberId: existingInvitation.memberId,
                status: 'expired',
              },
            );
          } else {
            return {
              member: mapMember(existingInvitation.member),
              relationship: null,
              invitation: mapInvitation(existingInvitation),
            };
          }
        }
        if (input.targetUserId) {
          const existingMember = await tx.householdMember.findFirst({
            where: {
              householdId,
              status: 'active',
              familyPerson: { is: { accountUserId: input.targetUserId } },
            },
          });
          if (existingMember) {
            await tx.auditLog.create({
              data: {
                id: randomUUID(),
                actorUserId: meta.actorUserId,
                callerService: meta.callerService,
                action: 'customer.family.invitation.duplicate_member',
                resourceType: 'household_member',
                resourceId: existingMember.id,
                correlationId: meta.correlationId,
                after: { householdId, memberId: existingMember.id },
              },
            });
            return { member: mapMember(existingMember), relationship: null, invitation: null };
          }
        }
      }

      let relativeMemberId: string | null = null;
      const requestedRelative = input.relativeMemberId ?? 'viewer';
      if (requestedRelative === 'viewer') {
        let viewerMember = await tx.householdMember.findFirst({
          where: {
            householdId,
            status: 'active',
            familyPerson: { is: { accountUserId: meta.actorUserId } },
          },
          include: { familyPerson: true },
        });
        if (!viewerMember) {
          let viewerPerson = await tx.familyPerson.findUnique({
            where: { accountUserId: meta.actorUserId },
          });
          if (!viewerPerson) {
            viewerPerson = await tx.familyPerson.create({
              data: {
                id: randomUUID(),
                accountUserId: meta.actorUserId,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }
          const now = new Date();
          viewerMember = await tx.householdMember.create({
            data: {
              id: randomUUID(),
              householdId,
              displayName: 'عضو اصلی',
              relationship: 'خودم',
              familyPersonId: viewerPerson.id,
              isSelf: true,
              isDependent: false,
              status: 'active',
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
            include: { familyPerson: true },
          });
        }
        relativeMemberId = viewerMember.id;
      } else {
        const relative = await tx.householdMember.findFirst({
          where: { id: requestedRelative, householdId, status: 'active' },
          include: { familyPerson: { select: { accountUserId: true } } },
        });
        if (!relative) throw new NotFoundException('Family member not found.');
        if (
          relative.familyPerson?.accountUserId &&
          relative.familyPerson.accountUserId.toLowerCase() !== meta.actorUserId.toLowerCase()
        ) {
          throw new ForbiddenException(
            'Creating a relationship with another linked adult requires their consent.',
          );
        }
        relativeMemberId = relative.id;
      }

      const deferRelationship = shouldCreateInvitation && !input.isDependent;
      const person = await tx.familyPerson.create({
        data: { id: randomUUID(), createdAt: new Date(), updatedAt: new Date() },
      });
      const now = new Date();
      const member = await tx.householdMember.create({
        data: {
          id: randomUUID(),
          householdId,
          displayName,
          relationship: legacyRelationshipLabel(input.relationship),
          familyPersonId: person.id,
          displayGender: input.displayGender ?? 'unspecified',
          birthDate,
          isDependent: input.isDependent,
          status: deferRelationship ? 'pending' : 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });

      let relationship: (RelationshipEdge & { id?: string }) | null = null;
      let relationshipId: string | null = null;
      let deferredRelationship: {
        relativeMemberId: string;
        candidate: RelationshipEdge;
        newMemberIsFrom: boolean;
      } | null = null;
      if (relativeMemberId) {
        const direction = relationshipKindForInput(input.relationship);
        let fromMemberId = direction.newPersonIsFrom ? member.id : relativeMemberId;
        let toMemberId = direction.newPersonIsFrom ? relativeMemberId : member.id;
        if (direction.kind === 'spouse_of' || direction.kind === 'sibling_of') {
          [fromMemberId, toMemberId] = [fromMemberId, toMemberId].sort((a, b) =>
            a.localeCompare(b),
          );
        }
        const candidate: RelationshipEdge = {
          fromMemberId,
          toMemberId,
          kind: direction.kind,
          basis: input.basis,
        };
        if (deferRelationship) {
          deferredRelationship = {
            relativeMemberId,
            candidate,
            newMemberIsFrom: direction.newPersonIsFrom,
          };
        } else {
          const existing = await tx.householdRelationship.findMany({
            where: {
              householdId,
              fromMember: { is: { status: 'active' } },
              toMember: { is: { status: 'active' } },
            },
          });
          const conflict = validateRelationshipGraph(existing, candidate);
          if (conflict) {
            if (conflict === 'duplicate')
              throw new ConflictException('This relationship already exists.');
            if (conflict === 'cycle')
              throw new ConflictException('The relationship would create a family cycle.');
            throw new ConflictException('The relationship conflicts with an existing family fact.');
          }
          relationshipId = randomUUID();
          await tx.householdRelationship.create({
            data: {
              id: relationshipId,
              householdId,
              fromMemberId,
              toMemberId,
              kind: direction.kind,
              basis: input.basis,
              createdByUserId: meta.actorUserId,
              createdAt: now,
            },
          });
          relationship = { id: relationshipId, ...candidate };
        }
      }

      let invitation: Omit<FamilyInvitationDto, 'shareToken'> | null = null;
      if (shouldCreateInvitation) {
        if (!shareTokenHash) throw new Error('Family invitation token generation failed.');
        const id = randomUUID();
        const registeredTarget = Boolean(input.targetUserId);
        const invitationRow = await tx.householdInvitation.create({
          data: {
            id,
            householdId,
            memberId: member.id,
            relativeMemberId: deferredRelationship?.relativeMemberId ?? null,
            kind: input.isDependent ? 'dependent_claim' : 'adult_account',
            status: 'pending',
            relationshipKind: deferredRelationship?.candidate.kind ?? null,
            relationshipBasis: deferredRelationship?.candidate.basis ?? null,
            newMemberIsFrom: deferredRelationship?.newMemberIsFrom ?? null,
            targetUserId: input.targetUserId,
            targetPhoneHash: input.targetPhoneHash,
            tokenHash: shareTokenHash,
            tokenKeyVersion: 'v1',
            createdByUserId: meta.actorUserId,
            expiresAt: registeredTarget
              ? null
              : new Date(now.getTime() + invitationTtlDays() * 86_400_000),
            createdAt: now,
            updatedAt: now,
          },
        });
        invitation = mapInvitation(invitationRow);
      }

      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.family.member.created',
          resourceType: 'household_member',
          resourceId: member.id,
          correlationId: meta.correlationId,
          after: {
            householdId,
            memberId: member.id,
            relationshipKind: relationship?.kind ?? null,
            relationshipBasis: relationship?.basis ?? null,
            isDependent: member.isDependent,
            invitationId: invitation?.id ?? null,
          },
        },
      });
      if (member.status === 'active') {
        await this.persistFamilyEvent(
          tx,
          eventTypes.householdMemberCreated,
          householdId,
          meta.correlationId,
          { householdId, memberId: member.id },
        );
      }
      if (relationship) {
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyRelationshipChanged,
          householdId,
          meta.correlationId,
          { householdId, relationshipId },
        );
      }
      if (invitation) {
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyInvitationChanged,
          householdId,
          meta.correlationId,
          { householdId, invitationId: invitation.id, memberId: member.id, status: 'pending' },
        );
      }
      return { member: mapMember(member), relationship, invitation };
    });

    return {
      ...execution.result,
      invitation: execution.result.invitation
        ? {
            ...execution.result.invitation,
            ...(!execution.replayed && !input.targetUserId && shareToken ? { shareToken } : {}),
          }
        : null,
    };
  }

  async updateFamilyMember(
    householdId: string,
    memberId: string,
    input: UpdateFamilyMemberInput,
    meta: HouseholdCommandMeta,
  ) {
    let displayName: string | undefined;
    if (input.displayName !== undefined) {
      try {
        displayName = normalizeMemberText(input.displayName, 80);
      } catch {
        throw new BadRequestException('Household member information is invalid.');
      }
    }
    const hasRelationshipInput =
      input.relativeMemberId !== undefined ||
      input.relationship !== undefined ||
      input.basis !== undefined;
    if (
      hasRelationshipInput &&
      (!input.relativeMemberId ||
        !input.relationship ||
        !input.basis ||
        input.relativeMemberId === memberId)
    ) {
      throw new BadRequestException('A complete, non-self family relationship is required.');
    }
    if (
      displayName === undefined &&
      input.displayGender === undefined &&
      input.birthDate === undefined &&
      !hasRelationshipInput
    ) {
      throw new BadRequestException('At least one family member field must change.');
    }
    const birthDate =
      input.birthDate === undefined
        ? undefined
        : input.birthDate === null
          ? null
          : new Date(`${input.birthDate}T00:00:00.000Z`);
    if (
      birthDate instanceof Date &&
      (!Number.isFinite(birthDate.getTime()) || birthDate.getTime() > Date.now())
    ) {
      throw new BadRequestException('Birth date cannot be in the future.');
    }
    const command = {
      householdId,
      memberId,
      expectedVersion: input.expectedVersion,
      displayName: displayName ?? null,
      displayGender: input.displayGender ?? null,
      birthDate: input.birthDate ?? null,
      relationshipId: input.relationshipId ?? null,
      relativeMemberId: input.relativeMemberId ?? null,
      relationship: input.relationship ?? null,
      basis: input.basis ?? null,
    };
    return this.executeIdempotent('family.member.update', command, meta, async (tx) => {
      const access = await tx.householdAccess.findFirst({
        where: {
          householdId,
          userId: meta.actorUserId,
          status: 'active',
          role: { in: ['owner', 'guardian', 'member'] },
          household: { status: 'active' },
        },
        select: { role: true },
      });
      if (!access) throw new NotFoundException('Household not found.');
      const member = await tx.householdMember.findFirst({
        where: { id: memberId, householdId, status: 'active' },
        include: { familyPerson: { select: { accountUserId: true } } },
      });
      if (!member) throw new NotFoundException('Family member not found.');
      const isSelf =
        member.familyPerson?.accountUserId?.toLowerCase() === meta.actorUserId.toLowerCase();
      const canManageDependent =
        access.role === 'owner' || (access.role === 'guardian' && member.isDependent);
      if (member.familyPerson?.accountUserId && !isSelf) {
        throw new ForbiddenException('Only the linked account can change its own profile details.');
      }
      if (!canManageDependent && !isSelf) {
        throw new ForbiddenException(
          'This family member cannot be managed by the current household role.',
        );
      }
      if (hasRelationshipInput && !canManageDependent) {
        throw new ForbiddenException(
          'A household owner or guardian must manage family relationships.',
        );
      }

      const updatedCount = await tx.householdMember.updateMany({
        where: { id: memberId, householdId, status: 'active', version: input.expectedVersion },
        data: {
          ...(displayName === undefined ? {} : { displayName }),
          ...(input.displayGender === undefined ? {} : { displayGender: input.displayGender }),
          ...(birthDate === undefined ? {} : { birthDate }),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updatedCount.count !== 1) {
        throw new ConflictException('Family member changed; reload before saving.');
      }

      let relationship: (RelationshipEdge & { id: string }) | null = null;
      if (hasRelationshipInput) {
        const relative = await tx.householdMember.findFirst({
          where: { id: input.relativeMemberId!, householdId, status: 'active' },
          include: { familyPerson: { select: { accountUserId: true } } },
        });
        if (!relative) throw new NotFoundException('Family member not found.');
        if (
          relative.familyPerson?.accountUserId &&
          relative.familyPerson.accountUserId.toLowerCase() !== meta.actorUserId.toLowerCase()
        ) {
          throw new ForbiddenException(
            'Changing a relationship with another linked adult requires their consent.',
          );
        }
        const edges = await tx.householdRelationship.findMany({
          where: {
            householdId,
            fromMember: { is: { status: 'active' } },
            toMember: { is: { status: 'active' } },
          },
        });
        const previous = input.relationshipId
          ? edges.find(
              (edge) =>
                edge.id === input.relationshipId &&
                (edge.fromMemberId === memberId || edge.toMemberId === memberId),
            )
          : undefined;
        if (input.relationshipId && !previous)
          throw new NotFoundException('Family relationship not found.');

        const direction = relationshipKindForInput(input.relationship!);
        let fromMemberId = direction.newPersonIsFrom ? memberId : relative.id;
        let toMemberId = direction.newPersonIsFrom ? relative.id : memberId;
        if (direction.kind === 'spouse_of' || direction.kind === 'sibling_of') {
          [fromMemberId, toMemberId] = [fromMemberId, toMemberId].sort((left, right) =>
            left.localeCompare(right),
          );
        }
        const candidate: RelationshipEdge = {
          fromMemberId,
          toMemberId,
          kind: direction.kind,
          basis: input.basis!,
        };
        const conflict = validateRelationshipGraph(
          edges.filter((edge) => edge.id !== previous?.id),
          candidate,
        );
        if (conflict === 'duplicate')
          throw new ConflictException('This relationship already exists.');
        if (conflict === 'cycle')
          throw new ConflictException('The relationship would create a family cycle.');
        if (conflict === 'contradictory')
          throw new ConflictException('The relationship conflicts with an existing family fact.');

        const relationId = previous?.id ?? randomUUID();
        if (previous) {
          await tx.householdRelationship.update({
            where: { id: previous.id },
            data: { fromMemberId, toMemberId, kind: direction.kind, basis: input.basis! },
          });
        } else {
          await tx.householdRelationship.create({
            data: {
              id: relationId,
              householdId,
              fromMemberId,
              toMemberId,
              kind: direction.kind,
              basis: input.basis!,
              createdByUserId: meta.actorUserId,
              createdAt: new Date(),
            },
          });
        }
        relationship = { id: relationId, ...candidate };
        await tx.householdMember.update({
          where: { id: memberId },
          data: {
            relationship: legacyRelationshipLabel(input.relationship!),
            updatedAt: new Date(),
          },
        });
      }

      const updated = await tx.householdMember.findUniqueOrThrow({ where: { id: memberId } });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.family.member.updated',
          resourceType: 'household_member',
          resourceId: memberId,
          correlationId: meta.correlationId,
          before: { householdId, memberId, version: member.version, status: member.status },
          after: {
            householdId,
            memberId,
            version: updated.version,
            status: updated.status,
            ...(relationship ? { relationshipId: relationship.id } : {}),
          },
        },
      });
      await this.persistFamilyEvent(
        tx,
        eventTypes.householdMemberUpdated,
        householdId,
        meta.correlationId,
        {
          householdId,
          memberId,
          status: updated.status,
          version: updated.version,
        },
      );
      if (relationship) {
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyRelationshipChanged,
          householdId,
          meta.correlationId,
          {
            householdId,
            relationshipId: relationship.id,
          },
        );
      }
      return mapMember(updated);
    });
  }

  async removeFamilyRelationship(
    householdId: string,
    relationshipId: string,
    input: { memberId: string; expectedVersion: number },
    meta: HouseholdCommandMeta,
  ) {
    const command = { householdId, relationshipId, ...input };
    return this.executeIdempotent('family.relationship.remove', command, meta, async (tx) => {
      const access = await tx.householdAccess.findFirst({
        where: {
          householdId,
          userId: meta.actorUserId,
          status: 'active',
          role: { in: ['owner', 'guardian'] },
          household: { status: 'active' },
        },
        select: { role: true },
      });
      if (!access) throw new NotFoundException('Household not found.');
      const edge = await tx.householdRelationship.findFirst({
        where: { id: relationshipId, householdId },
      });
      if (!edge || (edge.fromMemberId !== input.memberId && edge.toMemberId !== input.memberId)) {
        throw new NotFoundException('Family relationship not found.');
      }
      const member = await tx.householdMember.findFirst({
        where: { id: input.memberId, householdId, status: 'active' },
        include: { familyPerson: { select: { accountUserId: true } } },
      });
      const otherId = edge.fromMemberId === input.memberId ? edge.toMemberId : edge.fromMemberId;
      const other = await tx.householdMember.findFirst({
        where: { id: otherId, householdId, status: 'active' },
        include: { familyPerson: { select: { accountUserId: true } } },
      });
      if (!member || !other || (access.role === 'guardian' && !member.isDependent)) {
        throw new NotFoundException('Family relationship not found.');
      }
      for (const linkedUserId of [
        member.familyPerson?.accountUserId,
        other.familyPerson?.accountUserId,
      ]) {
        if (linkedUserId && linkedUserId.toLowerCase() !== meta.actorUserId.toLowerCase()) {
          throw new ForbiddenException(
            'Changing a relationship with another linked adult requires their consent.',
          );
        }
      }
      const updatedCount = await tx.householdMember.updateMany({
        where: { id: member.id, householdId, status: 'active', version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updatedCount.count !== 1)
        throw new ConflictException('Family member changed; reload before saving.');
      await tx.householdRelationship.delete({ where: { id: edge.id } });
      const remainingActiveRelationship = await tx.householdRelationship.findFirst({
        where: {
          householdId,
          OR: [{ fromMemberId: member.id }, { toMemberId: member.id }],
          fromMember: { is: { status: 'active' } },
          toMember: { is: { status: 'active' } },
        },
        select: { id: true },
      });
      if (!remainingActiveRelationship) {
        await tx.householdMember.update({
          where: { id: member.id },
          data: { relationship: 'عضو خانواده' },
        });
      }
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.family.relationship.removed',
          resourceType: 'household_relationship',
          resourceId: edge.id,
          correlationId: meta.correlationId,
          before: {
            householdId,
            relationshipId: edge.id,
            fromMemberId: edge.fromMemberId,
            toMemberId: edge.toMemberId,
            kind: edge.kind,
            basis: edge.basis,
          },
          after: { householdId, relationshipId: edge.id, status: 'removed', memberId: member.id },
        },
      });
      const updatedMember = await tx.householdMember.findUniqueOrThrow({
        where: { id: member.id },
      });
      await this.persistFamilyEvent(
        tx,
        eventTypes.familyRelationshipChanged,
        householdId,
        meta.correlationId,
        {
          householdId,
          relationshipId: edge.id,
        },
      );
      await this.persistFamilyEvent(
        tx,
        eventTypes.householdMemberUpdated,
        householdId,
        meta.correlationId,
        {
          householdId,
          memberId: member.id,
          status: updatedMember.status,
          version: updatedMember.version,
        },
      );
      return {
        relationshipId: edge.id,
        householdId,
        memberId: member.id,
        version: updatedMember.version,
      };
    });
  }

  async archiveFamilyMember(
    householdId: string,
    memberId: string,
    expectedVersion: number,
    meta: HouseholdCommandMeta,
  ) {
    const command = { householdId, memberId, expectedVersion };
    return this.executeIdempotent('family.member.archive', command, meta, async (tx) => {
      const access = await tx.householdAccess.findFirst({
        where: {
          householdId,
          userId: meta.actorUserId,
          status: 'active',
          role: { in: ['owner', 'guardian', 'member'] },
          household: { status: 'active' },
        },
        select: { role: true },
      });
      if (!access) throw new NotFoundException('Household not found.');
      const member = await tx.householdMember.findFirst({
        where: { id: memberId, householdId, status: 'active' },
        include: {
          familyPerson: { select: { accountUserId: true } },
          household: { select: { ownerUserId: true } },
        },
      });
      if (!member) throw new NotFoundException('Family member not found.');
      const linkedUserId = member.familyPerson?.accountUserId;
      const isSelf = linkedUserId?.toLowerCase() === meta.actorUserId.toLowerCase();
      const managesDependent =
        member.isDependent && (access.role === 'owner' || access.role === 'guardian');
      const selfLeaves = isSelf;
      if (!managesDependent && !selfLeaves) {
        throw new ForbiddenException(
          'Only a household owner, guardian, or the linked member can archive this membership.',
        );
      }
      if (linkedUserId && !isSelf && !managesDependent) {
        throw new ForbiddenException(
          'Only the linked member or a guardian can archive this membership.',
        );
      }
      if (linkedUserId?.toLowerCase() === member.household.ownerUserId.toLowerCase()) {
        throw new ConflictException('Transfer household ownership before leaving this household.');
      }
      const updatedCount = await tx.householdMember.updateMany({
        where: { id: memberId, householdId, status: 'active', version: expectedVersion },
        data: { status: 'archived', version: { increment: 1 }, updatedAt: new Date() },
      });
      if (updatedCount.count !== 1)
        throw new ConflictException('Family member changed; reload before archiving.');

      if (linkedUserId) {
        await tx.householdAccess.updateMany({
          where: { householdId, userId: linkedUserId, role: 'member', status: 'active' },
          data: { status: 'revoked' },
        });
      }
      const pendingInvitations = await tx.householdInvitation.findMany({
        where: {
          householdId,
          memberId,
          status: { in: ['pending', 'claim_pending', 'conflict_review'] },
        },
      });
      if (pendingInvitations.length) {
        await tx.householdInvitation.updateMany({
          where: {
            householdId,
            memberId,
            status: { in: ['pending', 'claim_pending', 'conflict_review'] },
          },
          data: { status: 'revoked', updatedAt: new Date() },
        });
        for (const invitation of pendingInvitations) {
          await this.auditInvitationStatus(
            tx,
            { ...invitation, status: 'revoked' },
            meta,
            'customer.family.invitation.revoked',
          );
          await this.persistFamilyEvent(
            tx,
            eventTypes.familyInvitationChanged,
            householdId,
            meta.correlationId,
            {
              householdId,
              invitationId: invitation.id,
              memberId,
              status: 'revoked',
            },
          );
        }
      }
      const archived = await tx.householdMember.findUniqueOrThrow({ where: { id: memberId } });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.family.member.archived',
          resourceType: 'household_member',
          resourceId: memberId,
          correlationId: meta.correlationId,
          before: { householdId, memberId, version: member.version, status: member.status },
          after: { householdId, memberId, version: archived.version, status: archived.status },
        },
      });
      await this.persistFamilyEvent(
        tx,
        eventTypes.householdMemberUpdated,
        householdId,
        meta.correlationId,
        {
          householdId,
          memberId,
          status: archived.status,
          version: archived.version,
        },
      );
      return mapMember(archived);
    });
  }

  async previewInvitation(token: string) {
    const tokenHash = hashShareToken(token);
    if (!tokenHash) return { valid: false as const };
    const invitation = await this.prisma.householdInvitation.findUnique({
      where: { tokenHash },
      include: {
        household: { select: { id: true, name: true } },
        member: { select: { id: true, displayName: true } },
      },
    });
    if (
      !invitation ||
      invitation.status !== 'pending' ||
      (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now())
    ) {
      return { valid: false as const };
    }
    return {
      valid: true as const,
      invitationId: invitation.id,
      householdName: invitation.household.name,
      memberName: invitation.member.displayName,
      kind: invitation.kind,
      expiresAt: invitation.expiresAt?.toISOString() ?? null,
    };
  }

  async acceptInvitation(
    input: { token?: string; invitationId?: string; verifiedPhoneHash?: string },
    meta: HouseholdCommandMeta,
  ) {
    const tokenHash = input.token ? hashShareToken(input.token) : null;
    if ((!tokenHash && !input.invitationId) || (tokenHash && input.invitationId)) {
      throw new BadRequestException('Exactly one invitation reference is required.');
    }
    const verifiedPhoneHash = input.verifiedPhoneHash;
    if (verifiedPhoneHash && !/^[a-f0-9]{64}$/iu.test(verifiedPhoneHash)) {
      throw new BadRequestException('Verified invitation identity is invalid.');
    }
    const command = {
      tokenHash,
      invitationId: input.invitationId ?? null,
      verifiedPhoneHash: verifiedPhoneHash ?? null,
    };
    return this.executeIdempotent('family.invitation.accept', command, meta, async (tx) => {
      const invitation = await tx.householdInvitation.findFirst({
        where: tokenHash ? { tokenHash } : { id: input.invitationId },
        include: { member: { include: { familyPerson: true } } },
      });
      if (!invitation) {
        throw new NotFoundException('Invitation is unavailable.');
      }
      if (
        invitation.acceptedByUserId === meta.actorUserId &&
        ['accepted', 'linked', 'conflict_review'].includes(invitation.status)
      ) {
        return mapInvitation(invitation);
      }
      if (invitation.claimUserId === meta.actorUserId && invitation.status === 'claim_pending') {
        return mapInvitation(invitation);
      }
      if (invitation.status === 'expired') return mapInvitation(invitation);
      if (invitation.status !== 'pending')
        throw new NotFoundException('Invitation is unavailable.');
      if (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now()) {
        const expired = await tx.householdInvitation.updateMany({
          where: { id: invitation.id, status: 'pending' },
          data: { status: 'expired' },
        });
        if (expired.count !== 1)
          throw new ConflictException('Invitation state changed; reload and try again.');
        if (invitation.member.status === 'pending') {
          await tx.householdMember.update({
            where: { id: invitation.memberId },
            data: { status: 'archived', version: { increment: 1 }, updatedAt: new Date() },
          });
        }
        const updated = await tx.householdInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        });
        await this.auditInvitationStatus(tx, updated, meta, 'customer.family.invitation.expired');
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyInvitationChanged,
          invitation.householdId,
          meta.correlationId,
          {
            householdId: invitation.householdId,
            invitationId: invitation.id,
            memberId: invitation.memberId,
            status: 'expired',
          },
        );
        return mapInvitation(updated);
      }
      if (invitation.targetUserId && invitation.targetUserId !== meta.actorUserId) {
        throw new NotFoundException('Invitation is unavailable.');
      }
      if (invitation.targetPhoneHash && invitation.targetPhoneHash !== verifiedPhoneHash) {
        throw new NotFoundException('Invitation is unavailable.');
      }
      if (
        invitation.kind === 'adult_account' &&
        !invitation.targetUserId &&
        !invitation.targetPhoneHash
      ) {
        throw new NotFoundException('Invitation is unavailable.');
      }
      const acceptedAt = new Date();
      const nextStatus = invitation.kind === 'dependent_claim' ? 'claim_pending' : 'accepted';
      const claimed = await tx.householdInvitation.updateMany({
        where: { id: invitation.id, status: 'pending' },
        data: {
          status: nextStatus,
          acceptedByUserId: nextStatus === 'accepted' ? meta.actorUserId : null,
          claimUserId: nextStatus === 'claim_pending' ? meta.actorUserId : null,
          acceptedAt,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Invitation state changed; reload and try again.');
      const updated = await tx.householdInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
        include: { member: { include: { familyPerson: true } } },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'customer.family.invitation.accepted',
          resourceType: 'household_invitation',
          resourceId: invitation.id,
          correlationId: meta.correlationId,
          after: {
            householdId: invitation.householdId,
            memberId: invitation.memberId,
            status: nextStatus,
          },
        },
      });
      if (nextStatus === 'claim_pending') {
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyInvitationChanged,
          invitation.householdId,
          meta.correlationId,
          {
            householdId: invitation.householdId,
            invitationId: invitation.id,
            memberId: invitation.memberId,
            status: nextStatus,
          },
        );
        return mapInvitation(updated);
      }
      return this.completeAdultInvitation(tx, updated, meta);
    });
  }

  async linkAcceptedInvitation(invitationId: string, meta: HouseholdCommandMeta) {
    const command = { invitationId };
    return this.executeIdempotent('family.invitation.link', command, meta, async (tx) => {
      const invitation = await tx.householdInvitation.findUnique({
        where: { id: invitationId },
        include: { member: { include: { familyPerson: true } } },
      });
      if (!invitation || invitation.kind !== 'adult_account')
        throw new NotFoundException('Invitation not found.');
      if (invitation.status === 'linked' && invitation.acceptedByUserId === meta.actorUserId) {
        return mapInvitation(invitation);
      }
      if (invitation.status !== 'accepted' || invitation.acceptedByUserId !== meta.actorUserId) {
        throw new ForbiddenException('Only the account that accepted this invitation can link it.');
      }
      return this.completeAdultInvitation(tx, invitation, meta);
    });
  }

  private async completeAdultInvitation(
    tx: Prisma.TransactionClient,
    invitation: AccountLinkInvitation,
    meta: HouseholdCommandMeta,
  ) {
    if (invitation.status === 'linked' && invitation.acceptedByUserId === meta.actorUserId) {
      return mapInvitation(invitation);
    }
    if (
      invitation.kind !== 'adult_account' ||
      invitation.status !== 'accepted' ||
      invitation.acceptedByUserId !== meta.actorUserId
    ) {
      throw new ForbiddenException('Only the account that accepted this invitation can link it.');
    }
    const activeHousehold = await tx.household.findFirst({
      where: { id: invitation.householdId, status: 'active' },
      select: { id: true },
    });
    if (!activeHousehold) throw new NotFoundException('Invitation is unavailable.');

    if (
      !invitation.relativeMemberId ||
      !invitation.relationshipKind ||
      !invitation.relationshipBasis ||
      invitation.newMemberIsFrom === null
    ) {
      return this.markInvitationConflict(tx, invitation, meta);
    }
    const relative = await tx.householdMember.findFirst({
      where: {
        id: invitation.relativeMemberId,
        householdId: invitation.householdId,
        status: 'active',
      },
      include: { familyPerson: { select: { accountUserId: true } } },
    });
    if (
      !relative ||
      relative.familyPerson?.accountUserId?.toLowerCase() !==
        invitation.createdByUserId.toLowerCase() ||
      invitation.member.status !== 'pending' ||
      !invitation.member.familyPersonId
    ) {
      return this.markInvitationConflict(tx, invitation, meta);
    }

    let fromMemberId = invitation.newMemberIsFrom
      ? invitation.memberId
      : invitation.relativeMemberId;
    let toMemberId = invitation.newMemberIsFrom ? invitation.relativeMemberId : invitation.memberId;
    if (
      invitation.relationshipKind === 'spouse_of' ||
      invitation.relationshipKind === 'sibling_of'
    ) {
      [fromMemberId, toMemberId] = [fromMemberId, toMemberId].sort((left, right) =>
        left.localeCompare(right),
      );
    }
    const candidate: RelationshipEdge = {
      fromMemberId,
      toMemberId,
      kind: invitation.relationshipKind,
      basis: invitation.relationshipBasis,
    };
    const activeMembers = await tx.householdMember.findMany({
      where: { householdId: invitation.householdId, status: 'active' },
      select: { id: true },
    });
    const activeIds = new Set(activeMembers.map((member) => member.id));
    const existingRelationships = await tx.householdRelationship.findMany({
      where: { householdId: invitation.householdId },
    });
    const validRelationships = existingRelationships.filter(
      (edge) => activeIds.has(edge.fromMemberId) && activeIds.has(edge.toMemberId),
    );
    if (validateRelationshipGraph(validRelationships, candidate)) {
      return this.markInvitationConflict(tx, invitation, meta);
    }

    const accountPerson = await tx.familyPerson.upsert({
      where: { accountUserId: meta.actorUserId },
      create: {
        id: randomUUID(),
        accountUserId: meta.actorUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {},
    });
    const duplicateMember = await tx.householdMember.findFirst({
      where: {
        householdId: invitation.householdId,
        familyPersonId: accountPerson.id,
        id: { not: invitation.memberId },
        status: { in: ['active', 'pending'] },
      },
      select: { id: true },
    });
    if (duplicateMember) return this.markInvitationConflict(tx, invitation, meta);

    const oldPersonId = invitation.member.familyPersonId;
    await tx.householdMember.update({
      where: { id: invitation.memberId },
      data: {
        familyPersonId: accountPerson.id,
        status: 'active',
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (oldPersonId !== accountPerson.id) {
      await tx.familyPerson.deleteMany({ where: { id: oldPersonId, members: { none: {} } } });
    }
    const relationshipId = randomUUID();
    await tx.householdRelationship.create({
      data: {
        id: relationshipId,
        householdId: invitation.householdId,
        fromMemberId,
        toMemberId,
        kind: invitation.relationshipKind,
        basis: invitation.relationshipBasis,
        createdByUserId: meta.actorUserId,
        createdAt: new Date(),
      },
    });
    await tx.householdAccess.upsert({
      where: {
        householdId_userId: { householdId: invitation.householdId, userId: meta.actorUserId },
      },
      create: {
        id: randomUUID(),
        householdId: invitation.householdId,
        userId: meta.actorUserId,
        role: 'member',
        status: 'active',
        createdAt: new Date(),
      },
      update: { status: 'active' },
    });
    const linkedCount = await tx.householdInvitation.updateMany({
      where: { id: invitation.id, status: 'accepted', acceptedByUserId: meta.actorUserId },
      data: { status: 'linked', acceptedAt: invitation.acceptedAt ?? new Date() },
    });
    if (linkedCount.count !== 1)
      throw new ConflictException('Invitation state changed; reload and try again.');
    const linked = await tx.householdInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    await this.auditInvitationStatus(tx, linked, meta, 'customer.family.account.linked');
    await this.persistFamilyEvent(
      tx,
      eventTypes.householdMemberCreated,
      invitation.householdId,
      meta.correlationId,
      { householdId: invitation.householdId, memberId: invitation.memberId },
    );
    await this.persistFamilyEvent(
      tx,
      eventTypes.familyRelationshipChanged,
      invitation.householdId,
      meta.correlationId,
      { householdId: invitation.householdId, relationshipId },
    );
    await this.persistFamilyEvent(
      tx,
      eventTypes.familyInvitationChanged,
      invitation.householdId,
      meta.correlationId,
      {
        householdId: invitation.householdId,
        invitationId: invitation.id,
        memberId: invitation.memberId,
        status: 'linked',
      },
    );
    return mapInvitation(linked);
  }

  private async markInvitationConflict(
    tx: Prisma.TransactionClient,
    invitation: AccountLinkInvitation,
    meta: HouseholdCommandMeta,
  ) {
    const updatedCount = await tx.householdInvitation.updateMany({
      where: { id: invitation.id, status: invitation.status },
      data: { status: 'conflict_review' },
    });
    if (updatedCount.count !== 1)
      throw new ConflictException('Invitation state changed; reload and try again.');
    const conflict = await tx.householdInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    await this.auditInvitationStatus(
      tx,
      conflict,
      meta,
      'customer.family.invitation.conflict_review',
    );
    await this.persistFamilyEvent(
      tx,
      eventTypes.familyInvitationChanged,
      invitation.householdId,
      meta.correlationId,
      {
        householdId: invitation.householdId,
        invitationId: invitation.id,
        memberId: invitation.memberId,
        status: 'conflict_review',
      },
    );
    return mapInvitation(conflict);
  }

  async approveDependentClaim(invitationId: string, meta: HouseholdCommandMeta) {
    return this.executeIdempotent(
      'family.dependent-claim.approve',
      { invitationId },
      meta,
      async (tx) => {
        const invitation = await tx.householdInvitation.findUnique({
          where: { id: invitationId },
          include: { member: { include: { familyPerson: true } } },
        });
        if (!invitation || invitation.kind !== 'dependent_claim')
          throw new NotFoundException('Invitation not found.');
        const access = await tx.householdAccess.findFirst({
          where: {
            householdId: invitation.householdId,
            userId: meta.actorUserId,
            status: 'active',
            role: { in: ['owner', 'guardian'] },
            household: { status: 'active' },
          },
          select: { role: true },
        });
        if (!access) throw new NotFoundException('Invitation not found.');
        if (access.role === 'guardian' && !invitation.member.isDependent) {
          throw new ForbiddenException('A guardian cannot approve an adult account link.');
        }
        if (invitation.status === 'linked') return mapInvitation(invitation);
        if (invitation.status !== 'claim_pending' || !invitation.claimUserId) {
          throw new ConflictException('This dependent claim is not awaiting approval.');
        }
        const claimed = await tx.householdInvitation.updateMany({
          where: {
            id: invitation.id,
            status: 'claim_pending',
            claimUserId: invitation.claimUserId,
          },
          data: { status: 'accepted' },
        });
        if (claimed.count !== 1)
          throw new ConflictException('Claim state changed; reload and try again.');
        const accepted = { ...invitation, status: 'accepted' as const };
        const accountPerson = await tx.familyPerson.upsert({
          where: { accountUserId: invitation.claimUserId },
          create: {
            id: randomUUID(),
            accountUserId: invitation.claimUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          update: {},
        });
        const duplicateMember = await tx.householdMember.findFirst({
          where: {
            householdId: invitation.householdId,
            familyPersonId: accountPerson.id,
            id: { not: invitation.memberId },
            status: { in: ['active', 'pending'] },
          },
          select: { id: true },
        });
        if (duplicateMember || !invitation.member.familyPersonId) {
          return this.markInvitationConflict(tx, accepted, meta);
        }
        const oldPersonId = invitation.member.familyPersonId;
        await tx.householdMember.update({
          where: { id: invitation.memberId },
          data: {
            familyPersonId: accountPerson.id,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (oldPersonId !== accountPerson.id) {
          await tx.familyPerson.deleteMany({ where: { id: oldPersonId, members: { none: {} } } });
        }
        await tx.householdAccess.upsert({
          where: {
            householdId_userId: {
              householdId: invitation.householdId,
              userId: invitation.claimUserId,
            },
          },
          create: {
            id: randomUUID(),
            householdId: invitation.householdId,
            userId: invitation.claimUserId,
            role: 'member',
            status: 'active',
            createdAt: new Date(),
          },
          update: { status: 'active' },
        });
        const linkedCount = await tx.householdInvitation.updateMany({
          where: { id: invitation.id, status: 'accepted', claimUserId: invitation.claimUserId },
          data: {
            status: 'linked',
            acceptedByUserId: invitation.claimUserId,
            acceptedAt: new Date(),
          },
        });
        if (linkedCount.count !== 1)
          throw new ConflictException('Claim state changed; reload and try again.');
        const linked = await tx.householdInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        });
        await this.auditInvitationStatus(
          tx,
          linked,
          meta,
          'customer.family.dependent_claim.approved',
        );
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyInvitationChanged,
          invitation.householdId,
          meta.correlationId,
          {
            householdId: invitation.householdId,
            invitationId: invitation.id,
            memberId: invitation.memberId,
            status: 'linked',
          },
        );
        return mapInvitation(linked);
      },
    );
  }

  async declineInvitation(
    invitationId: string,
    verifiedPhoneHash: string | undefined,
    meta: HouseholdCommandMeta,
  ) {
    return this.changeInvitationStatus(invitationId, 'declined', verifiedPhoneHash, meta);
  }

  async revokeInvitation(invitationId: string, meta: HouseholdCommandMeta) {
    return this.changeInvitationStatus(invitationId, 'revoked', undefined, meta);
  }

  private async changeInvitationStatus(
    invitationId: string,
    nextStatus: 'declined' | 'revoked',
    verifiedPhoneHash: string | undefined,
    meta: HouseholdCommandMeta,
  ) {
    return this.executeIdempotent(
      `family.invitation.${nextStatus}`,
      { invitationId, verifiedPhoneHash: verifiedPhoneHash ?? null },
      meta,
      async (tx) => {
        const invitation = await tx.householdInvitation.findUnique({
          where: { id: invitationId },
          include: { member: true },
        });
        if (!invitation) throw new NotFoundException('Invitation not found.');
        if (invitation.status === nextStatus) return mapInvitation(invitation);
        const mayBeDeclined =
          invitation.status === 'pending' || invitation.status === 'claim_pending';
        const mayBeRevoked =
          invitation.status === 'pending' ||
          invitation.status === 'claim_pending' ||
          invitation.status === 'accepted' ||
          invitation.status === 'expired' ||
          invitation.status === 'conflict_review';
        if (nextStatus === 'declined' ? !mayBeDeclined : !mayBeRevoked) {
          throw new ConflictException('Invitation cannot change from its current state.');
        }
        if (nextStatus === 'declined') {
          if (
            (invitation.targetUserId && invitation.targetUserId !== meta.actorUserId) ||
            (invitation.targetPhoneHash && invitation.targetPhoneHash !== verifiedPhoneHash) ||
            (!invitation.targetUserId &&
              !invitation.targetPhoneHash &&
              invitation.claimUserId !== meta.actorUserId)
          ) {
            throw new NotFoundException('Invitation not found.');
          }
        } else {
          const access = await tx.householdAccess.findFirst({
            where: {
              householdId: invitation.householdId,
              userId: meta.actorUserId,
              status: 'active',
              role: { in: ['owner', 'guardian'] },
            },
            select: { role: true },
          });
          if (!access) throw new NotFoundException('Invitation not found.');
          if (access.role === 'guardian' && !invitation.member.isDependent) {
            throw new ForbiddenException('A guardian can only revoke a dependent invitation.');
          }
        }
        const transition = await tx.householdInvitation.updateMany({
          where: { id: invitation.id, status: invitation.status },
          data: { status: nextStatus },
        });
        if (transition.count !== 1)
          throw new ConflictException('Invitation state changed; reload and try again.');
        if (invitation.member.status === 'pending') {
          await tx.householdMember.update({
            where: { id: invitation.memberId },
            data: { status: 'archived', version: { increment: 1 }, updatedAt: new Date() },
          });
        }
        const updated = await tx.householdInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        });
        await this.auditInvitationStatus(
          tx,
          updated,
          meta,
          nextStatus === 'declined'
            ? 'customer.family.invitation.declined'
            : 'customer.family.invitation.revoked',
        );
        await this.persistFamilyEvent(
          tx,
          eventTypes.familyInvitationChanged,
          invitation.householdId,
          meta.correlationId,
          {
            householdId: invitation.householdId,
            invitationId: invitation.id,
            memberId: invitation.memberId,
            status: nextStatus,
          },
        );
        return mapInvitation(updated);
      },
    );
  }

  private async persistFamilyEvent(
    tx: Prisma.TransactionClient,
    eventType: (typeof eventTypes)[keyof typeof eventTypes],
    aggregateId: string,
    correlationId: string,
    payload: Record<string, unknown>,
  ) {
    const envelope = createEventEnvelope({
      eventType,
      sourceId: 'customer-household',
      aggregateId,
      correlationId,
      payload,
    });
    await tx.outboxEvent.create({
      data: {
        id: envelope.eventId,
        eventType: envelope.eventType,
        aggregateId,
        envelope: envelope as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async auditInvitationStatus(
    tx: Prisma.TransactionClient,
    invitation: { id: string; householdId: string; memberId: string; status: string },
    meta: HouseholdCommandMeta,
    action: string,
  ) {
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: meta.actorUserId,
        callerService: meta.callerService,
        action,
        resourceType: 'household_invitation',
        resourceId: invitation.id,
        correlationId: meta.correlationId,
        after: {
          householdId: invitation.householdId,
          memberId: invitation.memberId,
          status: invitation.status,
        },
      },
    });
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
    return (await this.executeIdempotentDetailed(operation, command, meta, work)).result;
  }

  private async executeIdempotentDetailed<T extends object>(
    operation: string,
    command: object,
    meta: HouseholdCommandMeta,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    const requestHash = hash({ operation, command, actorUserId: meta.actorUserId });
    const replay = await this.findReplay<T>(meta, requestHash);
    if (replay) return { result: replay, replayed: true };
    try {
      const result = await this.prisma.$transaction(async (tx) => {
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
      return { result, replayed: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.findReplay<T>(meta, requestHash);
      if (duplicate) return { result: duplicate, replayed: true };
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
  status: 'active' | 'pending' | 'archived';
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

function mapInvitation(value: {
  id: string;
  householdId: string;
  memberId: string;
  kind: 'adult_account' | 'dependent_claim';
  status:
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'revoked'
    | 'expired'
    | 'claim_pending'
    | 'linked'
    | 'conflict_review';
  expiresAt: Date | null;
  createdAt: Date;
}): Omit<FamilyInvitationDto, 'shareToken'> {
  return {
    id: value.id,
    householdId: value.householdId,
    memberId: value.memberId,
    kind: value.kind,
    status:
      value.status === 'pending' && value.expiresAt && value.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : value.status,
    // Keeping expiry out of household lists prevents account-state inference by the inviter.
    // The invitation preview shown to the actual link holder includes the precise expiry.
    expiresAt: null,
    createdAt: value.createdAt.toISOString(),
  };
}

function hashShareToken(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{40,128}$/u.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

function invitationTtlDays(): number {
  const raw = process.env.CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS;
  if (raw === undefined || raw === '') return 7;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error('CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS must be between 1 and 30.');
  }
  return value;
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
