import { Injectable } from '@nestjs/common';
import {
  AssetType,
  CardStatus,
  LedgerKind,
  MissionStatus,
  Prisma,
} from '../../../generated/prisma/index.js';
import {
  createEventEnvelope,
  eventEnvelopeSchema,
  eventTypes,
  type EventEnvelope,
} from '@funtino/event-contracts';
import { DomainError, hashSecret } from '@funtino/backend-core';
import type {
  Branch,
  Card,
  Household,
  HouseholdMember,
  LedgerEntry,
  Mission,
  MissionProgress,
  ManagementLoginChallenge,
  ManagementPasswordState,
  OtpChallenge,
  Session,
  User,
  UserAvatar,
  UserIdentitySummary,
  UserProfileUpdate,
  WalletAccount,
} from '../../domain/models.js';
import {
  type CreateHouseholdInput,
  type CreateMemberInput,
  type FuntinoStorePort,
  type OtpPurpose,
  type OtpVerificationResult,
} from './funtino-store.js';
import { PrismaService } from '../persistence/prisma/prisma.service.js';
import { OrganizationBranchClient } from '../organization-branch/organization-branch.client.js';

@Injectable()
export class PrismaFuntinoStore implements FuntinoStorePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationBranch: OrganizationBranchClient,
  ) {}

  async createUser(phoneE164: string): Promise<User> {
    return mapUser(
      await this.prisma.user.upsert({
        where: { phoneE164 },
        update: {},
        create: { phoneE164 },
      }),
    );
  }

  async getUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new DomainError('UNAUTHENTICATED', 'حساب کاربری پیدا نشد.');
    return mapUser(user);
  }

  async getUserByPhone(phoneE164: string): Promise<User | undefined> {
    const user = await this.prisma.user.findUnique({ where: { phoneE164 } });
    return user ? mapUser(user) : undefined;
  }

  async listUserIdentitySummaries(userIds: readonly string[]): Promise<UserIdentitySummary[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, displayName: true, firstName: true, lastName: true },
    });
    return rows.map((row) => ({
      userId: row.id,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
    }));
  }

  async getManagementPasswordState(userId: string): Promise<ManagementPasswordState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        managementPasswordHash: true,
        managementPasswordFailedAttempts: true,
        managementPasswordLockedUntil: true,
      },
    });
    if (!user) throw new DomainError('UNAUTHENTICATED', 'حساب کاربری پیدا نشد.');
    return {
      passwordHash: user.managementPasswordHash,
      failedAttempts: user.managementPasswordFailedAttempts,
      lockedUntil: user.managementPasswordLockedUntil?.getTime() ?? null,
    };
  }

  async recordManagementPasswordFailure(
    userId: string,
    now: number,
    maxAttempts: number,
    lockoutMs: number,
  ): Promise<ManagementPasswordState> {
    return this.prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<
        Array<{
          management_password_hash: string | null;
          management_password_failed_attempts: number;
          management_password_locked_until: Date | null;
        }>
      >`SELECT management_password_hash, management_password_failed_attempts, management_password_locked_until
        FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!user) throw new DomainError('UNAUTHENTICATED', 'حساب کاربری پیدا نشد.');
      const currentLock = user.management_password_locked_until?.getTime() ?? null;
      if (currentLock !== null && currentLock > now) {
        return {
          passwordHash: user.management_password_hash,
          failedAttempts: user.management_password_failed_attempts,
          lockedUntil: currentLock,
        };
      }
      const previousAttempts = currentLock !== null ? 0 : user.management_password_failed_attempts;
      const failedAttempts = previousAttempts + 1;
      const lockedUntil = failedAttempts >= maxAttempts ? now + lockoutMs : null;
      await tx.user.update({
        where: { id: userId },
        data: {
          managementPasswordFailedAttempts: failedAttempts,
          managementPasswordLockedUntil: lockedUntil === null ? null : new Date(lockedUntil),
        },
      });
      return { passwordHash: user.management_password_hash, failedAttempts, lockedUntil };
    });
  }

  async clearManagementPasswordFailures(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        managementPasswordFailedAttempts: 0,
        managementPasswordLockedUntil: null,
      },
    });
  }

  async setManagementPassword(
    userId: string,
    passwordHash: string | null,
    keepSessionId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          managementPasswordHash: passwordHash,
          managementPasswordFailedAttempts: 0,
          managementPasswordLockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: {
          userId,
          audience: 'management',
          id: { not: keepSessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  async updateUserProfile(userId: string, input: UserProfileUpdate): Promise<User> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: { select: { userId: true } } },
    });
    if (!current) throw new DomainError('UNAUTHENTICATED', 'حساب کاربری پیدا نشد.');

    const firstName =
      input.firstName === undefined ? current.firstName : cleanOptional(input.firstName, 60);
    const lastName =
      input.lastName === undefined ? current.lastName : cleanOptional(input.lastName, 60);
    const email = input.email === undefined ? current.email : cleanEmail(input.email);
    const birthDate =
      input.birthDate === undefined
        ? current.birthDate
        : input.birthDate
          ? new Date(input.birthDate)
          : null;
    const gender = input.gender === undefined ? current.gender : cleanOptional(input.gender, 30);
    const city = input.city === undefined ? current.city : cleanOptional(input.city, 80);
    const avatarPreset =
      input.avatarPreset === undefined
        ? current.avatarPreset
        : cleanOptional(input.avatarPreset, 40);
    const profileCompleted = Boolean(
      firstName && lastName && birthDate && gender && city && (avatarPreset || current.avatar),
    );

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            firstName,
            lastName,
            displayName: [firstName, lastName].filter(Boolean).join(' ') || null,
            email,
            birthDate,
            gender,
            city,
            avatarPreset,
            profileCompletedAt: profileCompleted
              ? (current.profileCompletedAt ?? new Date())
              : null,
          },
        });
        if (input.avatarPreset) await tx.userAvatar.deleteMany({ where: { userId } });
        return updated;
      });
      return mapUser(saved);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainError('CONFLICT', 'این ایمیل قبلاً برای حساب دیگری ثبت شده است.');
      }
      throw error;
    }
  }

  async getUserAvatar(userId: string): Promise<UserAvatar | undefined> {
    const avatar = await this.prisma.userAvatar.findUnique({ where: { userId } });
    return avatar
      ? {
          userId: avatar.userId,
          mimeType: avatar.mimeType,
          data: Buffer.from(avatar.data),
          updatedAt: avatar.updatedAt.toISOString(),
        }
      : undefined;
  }

  async saveUserAvatar(input: { userId: string; mimeType: string; data: Buffer }): Promise<User> {
    const current = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!current) throw new DomainError('UNAUTHENTICATED', 'حساب کاربری پیدا نشد.');
    const profileCompleted = Boolean(
      current.firstName && current.lastName && current.birthDate && current.gender && current.city,
    );
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.userAvatar.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, mimeType: input.mimeType, data: input.data },
        update: { mimeType: input.mimeType, data: input.data },
      });
      return tx.user.update({
        where: { id: input.userId },
        data: {
          avatarPreset: null,
          profileCompletedAt: profileCompleted ? (current.profileCompletedAt ?? new Date()) : null,
        },
      });
    });
    return mapUser(saved);
  }

  async saveOtpChallenge(input: {
    phoneE164: string;
    code: string;
    ttlMs: number;
    purpose?: OtpPurpose;
  }): Promise<OtpChallenge> {
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        phoneE164: input.phoneE164,
        purpose: input.purpose ?? 'customer_login',
        codeHash: hashSecret(input.code),
        expiresAt: new Date(Date.now() + input.ttlMs),
      },
    });
    return mapOtp(challenge);
  }

  async consumeOtpRequestCooldown(key: string, now: number, cooldownMs: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string }>>`
      INSERT INTO otp_request_throttles (key, next_allowed_at, updated_at)
      VALUES (${key}, ${new Date(now + cooldownMs)}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE
      SET next_allowed_at = EXCLUDED.next_allowed_at, updated_at = CURRENT_TIMESTAMP
      WHERE otp_request_throttles.next_allowed_at <= ${new Date(now)}
      RETURNING key`;
    return rows.length === 1;
  }

  async consumeOtpChallengeIfValid(input: {
    challengeId: string;
    phoneE164: string;
    purpose: OtpPurpose;
    codeHash: string;
    now: number;
  }): Promise<OtpVerificationResult> {
    return this.prisma.$transaction(async (tx) => {
      const [challenge] = await tx.$queryRaw<
        Array<{
          id: string;
          phone_e164: string;
          purpose: string;
          code_hash: string;
          attempts: number;
          expires_at: Date;
          consumed_at: Date | null;
        }>
      >`SELECT id, phone_e164, purpose, code_hash, attempts, expires_at, consumed_at
        FROM otp_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;
      if (!challenge) return { status: 'not_found' };
      if (challenge.phone_e164 !== input.phoneE164) return { status: 'phone_mismatch' };
      if (challenge.purpose !== input.purpose) return { status: 'purpose_mismatch' };
      if (challenge.consumed_at !== null) return { status: 'consumed' };
      if (challenge.expires_at.getTime() <= input.now) return { status: 'expired' };
      if (challenge.attempts >= 5) return { status: 'rate_limited' };
      if (challenge.code_hash !== input.codeHash) {
        const attempts = challenge.attempts + 1;
        await tx.otpChallenge.update({
          where: { id: input.challengeId },
          data: { attempts },
        });
        return { status: attempts >= 5 ? 'rate_limited' : 'invalid_code' };
      }
      const consumedAt = new Date(input.now);
      await tx.otpChallenge.update({
        where: { id: input.challengeId },
        data: { consumedAt },
      });
      return {
        status: 'verified',
        challenge: {
          id: challenge.id,
          phoneE164: challenge.phone_e164,
          purpose: challenge.purpose as OtpPurpose,
          codeHash: challenge.code_hash,
          attempts: challenge.attempts,
          expiresAt: challenge.expires_at.getTime(),
          consumedAt: consumedAt.getTime(),
        },
      };
    });
  }

  async getOtpChallenge(challengeId: string): Promise<OtpChallenge> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) throw new DomainError('NOT_FOUND', 'درخواست ورود پیدا نشد.');
    return mapOtp(challenge);
  }

  async incrementOtpAttempt(challengeId: string): Promise<number> {
    const challenge = await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    return challenge.attempts;
  }

  async consumeOtpChallenge(challengeId: string): Promise<void> {
    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });
  }

  async saveSession(
    userId: string,
    tokenHash: string,
    ttlMs: number,
    policy: { audience: 'customer' | 'management' } = {
      audience: 'customer',
    },
  ): Promise<Session> {
    const now = Date.now();
    return mapSession(
      await this.prisma.session.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(now + ttlMs),
          audience: policy.audience,
          lastActivityAt: new Date(now),
        },
      }),
    );
  }

  async saveManagementLoginChallenge(
    userId: string,
    tokenHash: string,
    ttlMs: number,
  ): Promise<ManagementLoginChallenge> {
    const challenge = await this.prisma.managementLoginChallenge.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + ttlMs) },
    });
    return mapManagementLoginChallenge(challenge);
  }

  async findManagementLoginChallenge(
    tokenHash: string,
  ): Promise<ManagementLoginChallenge | undefined> {
    const challenge = await this.prisma.managementLoginChallenge.findUnique({
      where: { tokenHash },
    });
    return challenge ? mapManagementLoginChallenge(challenge) : undefined;
  }

  async incrementManagementLoginChallengeAttempt(
    tokenHash: string,
    now: number,
    maxAttempts: number,
  ): Promise<boolean> {
    const result = await this.prisma.managementLoginChallenge.updateMany({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date(now) },
        attempts: { lt: maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (result.count !== 1) return false;
    const challenge = await this.prisma.managementLoginChallenge.findUnique({
      where: { tokenHash },
      select: { id: true, attempts: true },
    });
    if (challenge && challenge.attempts >= maxAttempts) {
      await this.prisma.managementLoginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date(now) },
      });
    }
    return true;
  }

  async consumeManagementLoginChallenge(tokenHash: string, now: number): Promise<boolean> {
    const result = await this.prisma.managementLoginChallenge.updateMany({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date(now) },
        attempts: { lt: 5 },
      },
      data: { consumedAt: new Date(now) },
    });
    return result.count === 1;
  }

  async touchSessionActivity(sessionId: string, at: number): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { lastActivityAt: new Date(at) },
    });
    if (result.count !== 1) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
  }

  async findSession(tokenHash: string): Promise<Session | undefined> {
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return session ? mapSession(session) : undefined;
  }

  async updateSessionMfa(
    sessionId: string,
    proof: { verifiedAt: string; factorVersion: number; method: 'totp' | 'recovery' },
  ): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: {
        mfaVerifiedAt: new Date(proof.verifiedAt),
        mfaFactorVersion: proof.factorVersion,
        mfaMethod: proof.method,
      },
    });
    if (result.count !== 1) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
  }

  async clearSessionMfa(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { mfaVerifiedAt: null, mfaFactorVersion: null, mfaMethod: null },
    });
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
  }

  async listBranches(): Promise<Branch[]> {
    return this.organizationBranch.listActiveBranches();
  }

  async getBranch(branchId: string): Promise<Branch> {
    return this.organizationBranch.getActiveBranch(branchId);
  }

  async createHousehold(input: CreateHouseholdInput, correlationId: string): Promise<Household> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new DomainError('VALIDATION_ERROR', 'نام خانواده باید بین ۲ تا ۸۰ نویسه باشد.');
    }
    const household = await this.prisma.$transaction(async (tx) => {
      const created = await tx.household.create({ data: { ownerUserId: input.ownerUserId, name } });
      const owner = await tx.user.findUnique({ where: { id: input.ownerUserId } });
      await tx.householdMember.create({
        data: {
          householdId: created.id,
          userId: input.ownerUserId,
          displayName: owner?.displayName ?? 'سرپرست خانواده',
          relationship: 'parent',
          isDependent: false,
        },
      });
      await tx.walletAccount.create({ data: { householdId: created.id, currency: 'IRR' } });
      await tx.auditLog.create({
        data: {
          actorUserId: input.ownerUserId,
          action: 'household.created',
          resourceType: 'household',
          resourceId: created.id,
          correlationId,
        },
      });
      const event = createEventEnvelope({
        eventType: eventTypes.householdCreated,
        sourceId: 'api-gateway',
        aggregateId: created.id,
        correlationId,
        payload: { householdId: created.id, ownerUserId: input.ownerUserId },
      });
      await tx.outboxEvent.create({
        data: {
          id: event.eventId,
          eventType: event.eventType,
          aggregateId: created.id,
          occurredAt: new Date(event.occurredAt),
          payload: event as Prisma.InputJsonValue,
        },
      });
      return created;
    });
    return mapHousehold(household);
  }

  async listHouseholdsForUser(userId: string): Promise<Household[]> {
    const households = await this.prisma.household.findMany({
      where: { OR: [{ ownerUserId: userId }, { members: { some: { userId } } }] },
      orderBy: { createdAt: 'asc' },
    });
    return households.map(mapHousehold);
  }

  async getHouseholdForUser(householdId: string, userId: string): Promise<Household> {
    const household = await this.prisma.household.findUnique({ where: { id: householdId } });
    if (!household) throw new DomainError('NOT_FOUND', 'خانواده پیدا نشد.');
    const allowed =
      household.ownerUserId === userId ||
      Boolean(await this.prisma.householdMember.findFirst({ where: { householdId, userId } }));
    if (!allowed) throw new DomainError('FORBIDDEN', 'به این خانواده دسترسی ندارید.');
    return mapHousehold(household);
  }

  async listMembers(householdId: string): Promise<HouseholdMember[]> {
    const members = await this.prisma.householdMember.findMany({
      where: { householdId },
      orderBy: { createdAt: 'asc' },
    });
    return members.map(mapMember);
  }

  async addMember(
    input: CreateMemberInput,
    actorUserId: string,
    correlationId: string,
  ): Promise<HouseholdMember> {
    await this.getHouseholdForUser(input.householdId, actorUserId);
    const name = input.displayName.trim();
    if (name.length < 2 || name.length > 80) {
      throw new DomainError('VALIDATION_ERROR', 'نام عضو باید بین ۲ تا ۸۰ نویسه باشد.');
    }
    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.householdMember.create({
        data: {
          householdId: input.householdId,
          displayName: name,
          relationship: input.relationship.trim().slice(0, 40),
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          isDependent: input.isDependent ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'household.member_added',
          resourceType: 'household_member',
          resourceId: created.id,
          correlationId,
        },
      });
      return created;
    });
    return mapMember(member);
  }

  async listCardsForUser(userId: string): Promise<Card[]> {
    const householdIds = (await this.listHouseholdsForUser(userId)).map(
      (household) => household.id,
    );
    if (!householdIds.length) return [];
    const cards = await this.prisma.card.findMany({ where: { householdId: { in: householdIds } } });
    return cards.map(mapCard);
  }

  async getCardWallet(cardId: string): Promise<WalletAccount | undefined> {
    const wallet = await this.prisma.walletAccount.findFirst({ where: { cardId } });
    return wallet ? mapWallet(wallet) : undefined;
  }

  async getCardByExternalId(externalCardId: string): Promise<Card | undefined> {
    const card = await this.prisma.card.findUnique({ where: { externalCardId } });
    return card ? mapCard(card) : undefined;
  }

  async markCardSynced(externalCardId: string, syncedAt: string): Promise<void> {
    await this.prisma.card.updateMany({
      where: { externalCardId },
      data: { status: CardStatus.active, lastSyncedAt: new Date(syncedAt) },
    });
  }

  async linkCard(input: {
    householdId: string;
    memberId?: string | null;
    branchId: string;
    externalCardId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<Card> {
    await this.getHouseholdForUser(input.householdId, input.actorUserId);
    const externalCardId = input.externalCardId.trim();
    if (externalCardId.length < 4 || externalCardId.length > 80) {
      throw new DomainError('VALIDATION_ERROR', 'شناسه‌ی کارت معتبر نیست.');
    }
    const existing = await this.prisma.card.findUnique({ where: { externalCardId } });
    await this.organizationBranch.getActiveBranch(input.branchId);
    if (existing) {
      if (existing.householdId === input.householdId) return mapCard(existing);
      throw new DomainError('CONFLICT', 'این کارت قبلاً به خانواده‌ی دیگری متصل شده است.');
    }
    if (input.memberId) {
      const member = await this.prisma.householdMember.findFirst({
        where: { id: input.memberId, householdId: input.householdId },
      });
      if (!member)
        throw new DomainError('VALIDATION_ERROR', 'عضو انتخاب‌شده متعلق به این خانواده نیست.');
    }
    const card = await this.prisma.$transaction(async (tx) => {
      const created = await tx.card.create({
        data: {
          householdId: input.householdId,
          memberId: input.memberId ?? null,
          branchId: input.branchId,
          externalCardId,
          status: CardStatus.pending_sync,
        },
      });
      await tx.walletAccount.create({
        data: { householdId: input.householdId, cardId: created.id, currency: 'IRR' },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: 'card.link_requested',
          resourceType: 'card',
          resourceId: created.id,
          correlationId: input.correlationId,
        },
      });
      const event = createEventEnvelope({
        eventType: eventTypes.cardLinked,
        sourceId: 'api-gateway',
        aggregateId: created.id,
        correlationId: input.correlationId,
        branchId: created.branchId,
        payload: {
          cardId: created.id,
          householdId: created.householdId,
          memberId: created.memberId,
          externalCardId: created.externalCardId,
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: event.eventId,
          eventType: event.eventType,
          aggregateId: created.id,
          occurredAt: new Date(event.occurredAt),
          payload: event as Prisma.InputJsonValue,
        },
      });
      return created;
    });
    return mapCard(card);
  }

  async ensureWallet(householdId: string, cardId: string | null = null): Promise<WalletAccount> {
    const existing = await this.prisma.walletAccount.findFirst({ where: { householdId, cardId } });
    if (existing) return mapWallet(existing);
    return mapWallet(
      await this.prisma.walletAccount.create({ data: { householdId, cardId, currency: 'IRR' } }),
    );
  }

  async getWalletForUser(walletId: string, userId: string): Promise<WalletAccount> {
    const wallet = await this.prisma.walletAccount.findUnique({ where: { id: walletId } });
    if (!wallet) throw new DomainError('NOT_FOUND', 'کیف پول پیدا نشد.');
    await this.getHouseholdForUser(wallet.householdId, userId);
    return mapWallet(wallet);
  }

  async listWalletsForUser(userId: string): Promise<WalletAccount[]> {
    const householdIds = (await this.listHouseholdsForUser(userId)).map(
      (household) => household.id,
    );
    if (!householdIds.length) return [];
    const wallets = await this.prisma.walletAccount.findMany({
      where: { householdId: { in: householdIds } },
    });
    return wallets.map(mapWallet);
  }

  async listLedgerEntries(walletId: string): Promise<LedgerEntry[]> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
    return entries.map(mapLedgerEntry);
  }

  async applyWalletLedgerEntry(input: {
    walletId: string;
    assetType: LedgerEntry['assetType'];
    kind: LedgerEntry['kind'];
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    source: string;
    occurredAt: string;
    metadata?: Record<string, unknown> | null;
    correlationId: string;
    organizationId?: string | null;
    branchId?: string | null;
  }): Promise<{ entry: LedgerEntry; created: boolean }> {
    const existing = await this.prisma.ledgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { entry: mapLedgerEntry(existing), created: false };
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const entry = await tx.ledgerEntry.create({
          data: {
            walletId: input.walletId,
            assetType: input.assetType as AssetType,
            kind: input.kind as LedgerKind,
            amountMinor: BigInt(input.amountMinor),
            currency: input.currency,
            idempotencyKey: input.idempotencyKey,
            source: input.source,
            occurredAt: new Date(input.occurredAt),
            ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
          },
        });
        const event = createEventEnvelope({
          eventType: eventTypes.walletCredited,
          sourceId: 'wallet',
          aggregateId: input.walletId,
          correlationId: input.correlationId,
          organizationId: input.organizationId,
          branchId: input.branchId,
          payload: {
            ledgerEntryId: entry.id,
            walletId: entry.walletId,
            assetType: input.assetType,
            amountMinor: input.amountMinor,
            currency: input.currency,
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: event.eventId,
            eventType: event.eventType,
            aggregateId: input.walletId,
            occurredAt: new Date(event.occurredAt),
            payload: event as Prisma.InputJsonValue,
          },
        });
        return entry;
      });
      return { entry: mapLedgerEntry(created), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.ledgerEntry.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (duplicate) return { entry: mapLedgerEntry(duplicate), created: false };
      }
      throw error;
    }
  }

  async listMissions(branchId?: string): Promise<Mission[]> {
    const now = new Date();
    const missions = await this.prisma.mission.findMany({
      where: {
        status: { in: [MissionStatus.published, MissionStatus.active] },
        startsAt: { lte: now },
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: { startsAt: 'desc' },
    });
    return missions.map(mapMission);
  }

  async getProgress(missionId: string, householdId: string): Promise<MissionProgress | undefined> {
    const progress = await this.prisma.missionProgress.findUnique({
      where: { missionId_householdId: { missionId, householdId } },
    });
    return progress ? mapProgress(progress) : undefined;
  }

  async claimMission(input: {
    missionId: string;
    householdId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<{ mission: Mission; progress: MissionProgress; alreadyClaimed: boolean }> {
    await this.getHouseholdForUser(input.householdId, input.actorUserId);
    const missionRecord = await this.prisma.mission.findUnique({ where: { id: input.missionId } });
    if (!missionRecord) throw new DomainError('NOT_FOUND', 'مأموریت فعال پیدا نشد.');
    const mission = mapMission(missionRecord);
    if (
      !(await this.listMissions(mission.branchId ?? undefined)).some(
        (item) => item.id === mission.id,
      )
    ) {
      throw new DomainError('NOT_FOUND', 'مأموریت فعال پیدا نشد.');
    }
    const existing = await this.prisma.missionProgress.findUnique({
      where: {
        missionId_householdId: { missionId: input.missionId, householdId: input.householdId },
      },
    });
    if (existing?.claimedAt)
      return { mission, progress: mapProgress(existing), alreadyClaimed: true };
    const progress = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.missionProgress.update({
            where: { id: existing.id },
            data: {
              progress: 100,
              completedAt: existing.completedAt ?? new Date(),
              claimedAt: new Date(),
            },
          })
        : await tx.missionProgress.create({
            data: {
              missionId: input.missionId,
              householdId: input.householdId,
              progress: 100,
              completedAt: new Date(),
              claimedAt: new Date(),
            },
          });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: 'mission.claimed',
          resourceType: 'mission',
          resourceId: mission.id,
          correlationId: input.correlationId,
        },
      });
      const event = createEventEnvelope({
        eventType: eventTypes.missionCompleted,
        sourceId: 'api-gateway',
        aggregateId: mission.id,
        correlationId: input.correlationId,
        payload: {
          missionId: mission.id,
          householdId: input.householdId,
          rewardType: mission.rewardType,
          rewardValue: mission.rewardValue,
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: event.eventId,
          eventType: event.eventType,
          aggregateId: mission.id,
          occurredAt: new Date(event.occurredAt),
          payload: event as Prisma.InputJsonValue,
        },
      });
      return saved;
    });
    return { mission, progress: mapProgress(progress), alreadyClaimed: false };
  }

  async recordAudit(
    actorUserId: string | null,
    action: string,
    resourceType: string,
    resourceId: string,
    correlationId: string,
    reason: string | null = null,
    scope?: { organizationId?: string | null; branchId?: string | null },
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        resourceType,
        resourceId,
        correlationId,
        reason,
        organizationId: scope?.organizationId ?? null,
        branchId: scope?.branchId ?? null,
      },
    });
  }

  async consumeOperationsCustomerLookupQuota(input: {
    actorUserId: string;
    branchId: string;
    windowStartedAt: number;
    maxRequests: number;
  }): Promise<number> {
    const windowStartedAt = new Date(input.windowStartedAt);
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      INSERT INTO "customer_lookup_rate_limits" (
        "actor_user_id", "branch_id", "window_started_at", "count", "updated_at"
      ) VALUES (
        ${input.actorUserId}::uuid, ${input.branchId}::uuid, ${windowStartedAt}, 1, NOW()
      )
      ON CONFLICT ("actor_user_id", "branch_id") DO UPDATE SET
        "count" = CASE
          WHEN "customer_lookup_rate_limits"."window_started_at" = EXCLUDED."window_started_at"
            THEN LEAST("customer_lookup_rate_limits"."count" + 1, ${input.maxRequests + 1})
          ELSE 1
        END,
        "window_started_at" = EXCLUDED."window_started_at",
        "updated_at" = NOW()
      RETURNING "count"
    `);
    const count = rows[0]?.count;
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سهمیه‌ی جست‌وجوی مشتری ثبت نشد.');
    }
    return count;
  }

  async takePendingEvents(): Promise<EventEnvelope[]> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: 50,
    });
    return events.map((event) => eventEnvelopeSchema.parse(event.payload));
  }

  async requeueEvents(events: EventEnvelope[]): Promise<void> {
    if (!events.length) return;
    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: events.map((event) => event.eventId) } },
      data: { attempts: { increment: 1 }, lastError: 'publish_failed' },
    });
  }

  async ackEvents(eventIds: string[]): Promise<void> {
    if (!eventIds.length) return;
    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: eventIds } },
      data: { publishedAt: new Date() },
    });
  }
}

function mapUser(value: {
  id: string;
  phoneE164: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthDate: Date | null;
  gender: string | null;
  city: string | null;
  avatarPreset: string | null;
  profileCompletedAt: Date | null;
  createdAt: Date;
}): User {
  return {
    id: value.id,
    phoneE164: value.phoneE164,
    displayName: value.displayName,
    firstName: value.firstName,
    lastName: value.lastName,
    email: value.email,
    birthDate: value.birthDate?.toISOString() ?? null,
    gender: value.gender,
    city: value.city,
    avatarPreset: value.avatarPreset,
    profileCompletedAt: value.profileCompletedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
  };
}
function mapOtp(value: {
  id: string;
  phoneE164: string;
  purpose: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}): OtpChallenge {
  return {
    id: value.id,
    phoneE164: value.phoneE164,
    purpose: value.purpose as OtpPurpose,
    codeHash: value.codeHash,
    attempts: value.attempts,
    expiresAt: value.expiresAt.getTime(),
    consumedAt: value.consumedAt?.getTime() ?? null,
  };
}
function mapSession(value: {
  id: string;
  userId: string;
  audience: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  mfaVerifiedAt: Date | null;
  mfaFactorVersion: number | null;
  mfaMethod: string | null;
  lastActivityAt: Date;
}): Session {
  return {
    id: value.id,
    userId: value.userId,
    audience: value.audience === 'management' ? 'management' : 'customer',
    tokenHash: value.tokenHash,
    expiresAt: value.expiresAt.getTime(),
    revokedAt: value.revokedAt?.getTime() ?? null,
    mfaVerifiedAt: value.mfaVerifiedAt?.getTime() ?? null,
    mfaFactorVersion: value.mfaFactorVersion,
    mfaMethod:
      value.mfaMethod === 'totp' || value.mfaMethod === 'recovery' ? value.mfaMethod : null,
    lastActivityAt: value.lastActivityAt.getTime(),
  };
}

function mapManagementLoginChallenge(value: {
  id: string;
  userId: string;
  tokenHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}): ManagementLoginChallenge {
  return {
    id: value.id,
    userId: value.userId,
    tokenHash: value.tokenHash,
    attempts: value.attempts,
    expiresAt: value.expiresAt.getTime(),
    consumedAt: value.consumedAt?.getTime() ?? null,
  };
}
function mapHousehold(value: {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: Date;
}): Household {
  return {
    id: value.id,
    ownerUserId: value.ownerUserId,
    name: value.name,
    createdAt: value.createdAt.toISOString(),
  };
}
function mapMember(value: {
  id: string;
  householdId: string;
  userId: string | null;
  displayName: string;
  relationship: string;
  birthDate: Date | null;
  isDependent: boolean;
}): HouseholdMember {
  return {
    id: value.id,
    householdId: value.householdId,
    userId: value.userId,
    displayName: value.displayName,
    relationship: value.relationship,
    birthDate: value.birthDate?.toISOString() ?? null,
    isDependent: value.isDependent,
  };
}
function mapCard(value: {
  id: string;
  householdId: string;
  memberId: string | null;
  branchId: string | null;
  externalCardId: string;
  status: CardStatus;
  lastSyncedAt: Date | null;
}): Card {
  return {
    id: value.id,
    householdId: value.householdId,
    memberId: value.memberId,
    branchId: value.branchId,
    externalCardId: value.externalCardId,
    status: value.status as Card['status'],
    lastSyncedAt: value.lastSyncedAt?.toISOString() ?? null,
  };
}
function mapWallet(value: {
  id: string;
  householdId: string;
  cardId: string | null;
  currency: string;
}): WalletAccount {
  return {
    id: value.id,
    householdId: value.householdId,
    cardId: value.cardId,
    currency: value.currency,
  };
}
function mapLedgerEntry(value: {
  id: string;
  walletId: string;
  assetType: AssetType;
  kind: LedgerKind;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  source: string;
  occurredAt: Date;
}): LedgerEntry {
  return {
    id: value.id,
    walletId: value.walletId,
    assetType: value.assetType as LedgerEntry['assetType'],
    kind: value.kind as LedgerEntry['kind'],
    amountMinor: Number(value.amountMinor),
    currency: value.currency,
    idempotencyKey: value.idempotencyKey,
    source: value.source,
    occurredAt: value.occurredAt.toISOString(),
  };
}
function mapMission(value: {
  id: string;
  organizationId: string | null;
  branchId: string | null;
  title: string;
  description: string;
  status: MissionStatus;
  rewardType: string;
  rewardValue: number;
  startsAt: Date;
  endsAt: Date | null;
}): Mission {
  return {
    id: value.id,
    organizationId: value.organizationId,
    branchId: value.branchId,
    title: value.title,
    description: value.description,
    status: value.status as Mission['status'],
    rewardType: value.rewardType as Mission['rewardType'],
    rewardValue: value.rewardValue,
    startsAt: value.startsAt.toISOString(),
    endsAt: value.endsAt?.toISOString() ?? null,
  };
}
function mapProgress(value: {
  missionId: string;
  householdId: string;
  progress: number;
  completedAt: Date | null;
  claimedAt: Date | null;
}): MissionProgress {
  return {
    missionId: value.missionId,
    householdId: value.householdId,
    progress: value.progress,
    completedAt: value.completedAt?.toISOString() ?? null,
    claimedAt: value.claimedAt?.toISOString() ?? null,
  };
}

function cleanOptional(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function cleanEmail(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}
