import { Injectable } from '@nestjs/common';
import { createEventEnvelope, eventTypes, type EventEnvelope } from '@funtino/event-contracts';
import { DomainError, hashSecret } from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import type {
  AuditRecord,
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

export const FUNTINO_STORE = Symbol('FUNTINO_STORE');
export type StoreResult<T> = T | Promise<T>;
export type OtpPurpose = 'customer_login' | 'management_login' | 'management_password';
export type OtpVerificationResult =
  | { status: 'verified'; challenge: OtpChallenge }
  | {
      status:
        | 'not_found'
        | 'phone_mismatch'
        | 'purpose_mismatch'
        | 'expired'
        | 'consumed'
        | 'rate_limited'
        | 'invalid_code';
    };

export interface FuntinoStorePort {
  createUser(phoneE164: string): StoreResult<User>;
  getUser(userId: string): StoreResult<User>;
  getUserByPhone(phoneE164: string): StoreResult<User | undefined>;
  listUserIdentitySummaries(userIds: readonly string[]): StoreResult<UserIdentitySummary[]>;
  getManagementPasswordState(userId: string): StoreResult<ManagementPasswordState>;
  recordManagementPasswordFailure(
    userId: string,
    now: number,
    maxAttempts: number,
    lockoutMs: number,
  ): StoreResult<ManagementPasswordState>;
  clearManagementPasswordFailures(userId: string): StoreResult<void>;
  setManagementPassword(
    userId: string,
    passwordHash: string | null,
    keepSessionId: string,
  ): StoreResult<void>;
  updateUserProfile(userId: string, input: UserProfileUpdate): StoreResult<User>;
  getUserAvatar(userId: string): StoreResult<UserAvatar | undefined>;
  saveUserAvatar(input: { userId: string; mimeType: string; data: Buffer }): StoreResult<User>;
  saveOtpChallenge(input: {
    phoneE164: string;
    code: string;
    ttlMs: number;
    purpose?: OtpPurpose;
  }): StoreResult<OtpChallenge>;
  consumeOtpRequestCooldown(key: string, now: number, cooldownMs: number): StoreResult<boolean>;
  consumeOtpChallengeIfValid(input: {
    challengeId: string;
    phoneE164: string;
    purpose: OtpPurpose;
    codeHash: string;
    now: number;
  }): StoreResult<OtpVerificationResult>;
  getOtpChallenge(challengeId: string): StoreResult<OtpChallenge>;
  incrementOtpAttempt(challengeId: string): StoreResult<number>;
  consumeOtpChallenge(challengeId: string): StoreResult<void>;
  saveSession(
    userId: string,
    tokenHash: string,
    ttlMs: number,
    policy?: { audience: 'customer' | 'management' },
  ): StoreResult<Session>;
  saveManagementLoginChallenge(
    userId: string,
    tokenHash: string,
    ttlMs: number,
  ): StoreResult<ManagementLoginChallenge>;
  findManagementLoginChallenge(
    tokenHash: string,
  ): StoreResult<ManagementLoginChallenge | undefined>;
  incrementManagementLoginChallengeAttempt(
    tokenHash: string,
    now: number,
    maxAttempts: number,
  ): StoreResult<boolean>;
  consumeManagementLoginChallenge(tokenHash: string, now: number): StoreResult<boolean>;
  findSession(tokenHash: string): StoreResult<Session | undefined>;
  touchSessionActivity(sessionId: string, at: number): StoreResult<void>;
  updateSessionMfa(
    sessionId: string,
    proof: { verifiedAt: string; factorVersion: number; method: 'totp' | 'recovery' },
  ): StoreResult<void>;
  clearSessionMfa(sessionId: string): StoreResult<void>;
  revokeSession(tokenHash: string): StoreResult<void>;
  listBranches(): StoreResult<Branch[]>;
  getBranch(branchId: string): StoreResult<Branch>;
  createHousehold(input: CreateHouseholdInput, correlationId: string): StoreResult<Household>;
  listHouseholdsForUser(userId: string): StoreResult<Household[]>;
  getHouseholdForUser(householdId: string, userId: string): StoreResult<Household>;
  listMembers(householdId: string): StoreResult<HouseholdMember[]>;
  addMember(
    input: CreateMemberInput,
    actorUserId: string,
    correlationId: string,
  ): StoreResult<HouseholdMember>;
  listCardsForUser(userId: string): StoreResult<Card[]>;
  getCardWallet(cardId: string): StoreResult<WalletAccount | undefined>;
  getCardByExternalId(externalCardId: string): StoreResult<Card | undefined>;
  markCardSynced(externalCardId: string, syncedAt: string): StoreResult<void>;
  linkCard(input: {
    householdId: string;
    memberId?: string | null;
    branchId: string;
    externalCardId: string;
    actorUserId: string;
    correlationId: string;
  }): StoreResult<Card>;
  ensureWallet(householdId: string, cardId?: string | null): StoreResult<WalletAccount>;
  getWalletForUser(walletId: string, userId: string): StoreResult<WalletAccount>;
  listWalletsForUser(userId: string): StoreResult<WalletAccount[]>;
  listLedgerEntries(walletId: string): StoreResult<LedgerEntry[]>;
  applyWalletLedgerEntry(input: {
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
  }): StoreResult<{ entry: LedgerEntry; created: boolean }>;
  listMissions(branchId?: string): StoreResult<Mission[]>;
  getProgress(missionId: string, householdId: string): StoreResult<MissionProgress | undefined>;
  claimMission(input: {
    missionId: string;
    householdId: string;
    actorUserId: string;
    correlationId: string;
  }): StoreResult<{ mission: Mission; progress: MissionProgress; alreadyClaimed: boolean }>;
  recordAudit(
    actorUserId: string | null,
    action: string,
    resourceType: string,
    resourceId: string,
    correlationId: string,
    reason?: string | null,
    scope?: { organizationId?: string | null; branchId?: string | null },
  ): StoreResult<void>;
  consumeOperationsCustomerLookupQuota(input: {
    actorUserId: string;
    branchId: string;
    windowStartedAt: number;
    maxRequests: number;
  }): StoreResult<number>;
  takePendingEvents(): StoreResult<EventEnvelope[]>;
  requeueEvents(events: EventEnvelope[]): StoreResult<void>;
  ackEvents(eventIds: string[]): StoreResult<void>;
}

export const DEMO_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_BRANCH_ID = '22222222-2222-4222-8222-222222222222';
export const DEMO_MISSION_ID = '33333333-3333-4333-8333-333333333333';

export type CreateHouseholdInput = { ownerUserId: string; name: string };
export type CreateMemberInput = {
  householdId: string;
  displayName: string;
  relationship: string;
  birthDate?: string | null;
  isDependent?: boolean;
};

@Injectable()
export class InMemoryFuntinoStore implements FuntinoStorePort {
  readonly users = new Map<string, User>();
  readonly usersByPhone = new Map<string, string>();
  readonly otpChallenges = new Map<string, OtpChallenge>();
  readonly managementLoginChallenges = new Map<string, ManagementLoginChallenge>();
  readonly managementCredentials = new Map<string, ManagementPasswordState>();
  readonly sessions = new Map<string, Session>();
  readonly households = new Map<string, Household>();
  readonly householdMembers = new Map<string, HouseholdMember>();
  readonly branches = new Map<string, Branch>();
  readonly cards = new Map<string, Card>();
  readonly cardsByExternalId = new Map<string, string>();
  readonly wallets = new Map<string, WalletAccount>();
  readonly ledgerEntries = new Map<string, LedgerEntry>();
  readonly missions = new Map<string, Mission>();
  readonly progress = new Map<string, MissionProgress>();
  readonly outbox = new Map<string, EventEnvelope>();
  readonly audits: AuditRecord[] = [];
  private readonly customerLookupQuotas = new Map<
    string,
    { windowStartedAt: number; count: number }
  >();
  private readonly otpRequestThrottles = new Map<string, number>();

  constructor() {
    this.seed();
  }

  private seed(): void {
    this.branches.set(DEMO_BRANCH_ID, {
      id: DEMO_BRANCH_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      name: 'فانتینو ایران‌مال',
      slug: 'iranmall',
      address: 'تهران، ایران‌مال، طبقه‌ی شهربازی',
      city: 'تهران',
      timezone: 'Asia/Tehran',
      isActive: true,
      openingHours: {
        saturday: { open: '10:00', close: '23:00' },
        sunday: { open: '10:00', close: '23:00' },
        monday: { open: '10:00', close: '23:00' },
        tuesday: { open: '10:00', close: '23:00' },
        wednesday: { open: '10:00', close: '23:00' },
        thursday: { open: '10:00', close: '23:30' },
        friday: { open: '10:00', close: '23:30' },
      },
    });

    this.missions.set(DEMO_MISSION_ID, {
      id: DEMO_MISSION_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      branchId: DEMO_BRANCH_ID,
      title: 'یک دور کامل کشف کن',
      description: 'سه جاذبه‌ی تازه را در ایران‌مال ببین و یک نشان ویژه بگیر.',
      status: 'active',
      rewardType: 'loyalty_points',
      rewardValue: 500,
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
  }

  createUser(phoneE164: string): User {
    const existingId = this.usersByPhone.get(phoneE164);
    if (existingId) return this.users.get(existingId)!;

    const user: User = {
      id: randomUUID(),
      phoneE164,
      displayName: null,
      firstName: null,
      lastName: null,
      email: null,
      birthDate: null,
      gender: null,
      city: null,
      avatarPreset: null,
      profileCompletedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.usersByPhone.set(phoneE164, user.id);
    return user;
  }

  getUser(userId: string): User {
    const user = this.users.get(userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'حساب کاربری پیدا نشد.');
    return user;
  }

  getUserByPhone(phoneE164: string): User | undefined {
    const id = this.usersByPhone.get(phoneE164);
    return id ? this.users.get(id) : undefined;
  }

  listUserIdentitySummaries(userIds: readonly string[]): UserIdentitySummary[] {
    return [...new Set(userIds)].flatMap((userId) => {
      const user = this.users.get(userId);
      return user
        ? [
            {
              userId,
              displayName: user.displayName,
              firstName: user.firstName,
              lastName: user.lastName,
            },
          ]
        : [];
    });
  }

  getManagementPasswordState(userId: string): ManagementPasswordState {
    const state = this.managementCredentials.get(userId);
    return state ? { ...state } : { passwordHash: null, failedAttempts: 0, lockedUntil: null };
  }

  recordManagementPasswordFailure(
    userId: string,
    now: number,
    maxAttempts: number,
    lockoutMs: number,
  ): ManagementPasswordState {
    const state = this.getManagementPasswordState(userId);
    if (state.lockedUntil !== null && state.lockedUntil > now) return state;
    if (state.lockedUntil !== null) {
      state.failedAttempts = 0;
      state.lockedUntil = null;
    }
    state.failedAttempts += 1;
    if (state.failedAttempts >= maxAttempts) state.lockedUntil = now + lockoutMs;
    this.managementCredentials.set(userId, state);
    return { ...state };
  }

  clearManagementPasswordFailures(userId: string): void {
    const state = this.getManagementPasswordState(userId);
    state.failedAttempts = 0;
    state.lockedUntil = null;
    this.managementCredentials.set(userId, state);
  }

  setManagementPassword(userId: string, passwordHash: string | null, keepSessionId: string): void {
    if (!this.users.has(userId)) throw new DomainError('NOT_FOUND', 'حساب کاربری پیدا نشد.');
    this.managementCredentials.set(userId, {
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
    });
    for (const session of this.sessions.values()) {
      if (
        session.userId === userId &&
        session.audience === 'management' &&
        session.id !== keepSessionId &&
        session.revokedAt === null
      ) {
        session.revokedAt = Date.now();
      }
    }
  }

  updateUserProfile(userId: string, input: UserProfileUpdate): User {
    const user = this.getUser(userId);
    if (input.firstName !== undefined) user.firstName = cleanOptional(input.firstName, 60);
    if (input.lastName !== undefined) user.lastName = cleanOptional(input.lastName, 60);
    if (input.email !== undefined) user.email = cleanEmail(input.email);
    if (input.birthDate !== undefined) user.birthDate = input.birthDate;
    if (input.gender !== undefined) user.gender = cleanOptional(input.gender, 30);
    if (input.city !== undefined) user.city = cleanOptional(input.city, 80);
    if (input.avatarPreset !== undefined) {
      user.avatarPreset = cleanOptional(input.avatarPreset, 40);
      if (user.avatarPreset) this.avatars.delete(userId);
    }
    user.displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
    user.profileCompletedAt = isProfileComplete(user, this.avatars.has(userId))
      ? (user.profileCompletedAt ?? new Date().toISOString())
      : null;
    return user;
  }

  readonly avatars = new Map<string, UserAvatar>();

  getUserAvatar(userId: string): UserAvatar | undefined {
    return this.avatars.get(userId);
  }

  saveUserAvatar(input: { userId: string; mimeType: string; data: Buffer }): User {
    const user = this.getUser(input.userId);
    this.avatars.set(input.userId, {
      userId: input.userId,
      mimeType: input.mimeType,
      data: input.data,
      updatedAt: new Date().toISOString(),
    });
    user.avatarPreset = null;
    user.profileCompletedAt = isProfileComplete(user, true)
      ? (user.profileCompletedAt ?? new Date().toISOString())
      : null;
    return user;
  }

  saveOtpChallenge(input: {
    phoneE164: string;
    code: string;
    ttlMs: number;
    purpose?: OtpPurpose;
  }): OtpChallenge {
    const challenge: OtpChallenge = {
      id: randomUUID(),
      phoneE164: input.phoneE164,
      purpose: input.purpose ?? 'customer_login',
      codeHash: hashSecret(input.code),
      attempts: 0,
      expiresAt: Date.now() + input.ttlMs,
      consumedAt: null,
    };
    this.otpChallenges.set(challenge.id, challenge);
    return challenge;
  }

  consumeOtpRequestCooldown(key: string, now: number, cooldownMs: number): boolean {
    const nextAllowedAt = this.otpRequestThrottles.get(key) ?? 0;
    if (nextAllowedAt > now) return false;
    this.otpRequestThrottles.set(key, now + cooldownMs);
    return true;
  }

  consumeOtpChallengeIfValid(input: {
    challengeId: string;
    phoneE164: string;
    purpose: OtpPurpose;
    codeHash: string;
    now: number;
  }): OtpVerificationResult {
    const challenge = this.otpChallenges.get(input.challengeId);
    if (!challenge) return { status: 'not_found' };
    if (challenge.phoneE164 !== input.phoneE164) return { status: 'phone_mismatch' };
    if (challenge.purpose !== input.purpose) return { status: 'purpose_mismatch' };
    if (challenge.consumedAt !== null) return { status: 'consumed' };
    if (challenge.expiresAt <= input.now) return { status: 'expired' };
    if (challenge.attempts >= 5) return { status: 'rate_limited' };
    if (challenge.codeHash !== input.codeHash) {
      challenge.attempts += 1;
      return { status: challenge.attempts >= 5 ? 'rate_limited' : 'invalid_code' };
    }
    challenge.consumedAt = input.now;
    return { status: 'verified', challenge };
  }

  getOtpChallenge(challengeId: string): OtpChallenge {
    const challenge = this.otpChallenges.get(challengeId);
    if (!challenge) throw new DomainError('NOT_FOUND', 'درخواست ورود پیدا نشد.');
    return challenge;
  }

  incrementOtpAttempt(challengeId: string): number {
    const challenge = this.getOtpChallenge(challengeId);
    challenge.attempts += 1;
    return challenge.attempts;
  }

  consumeOtpChallenge(challengeId: string): void {
    const challenge = this.getOtpChallenge(challengeId);
    challenge.consumedAt = Date.now();
  }

  saveSession(
    userId: string,
    tokenHash: string,
    ttlMs: number,
    policy: { audience: 'customer' | 'management' } = {
      audience: 'customer',
    },
  ): Session {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      userId,
      audience: policy.audience,
      tokenHash,
      expiresAt: now + ttlMs,
      revokedAt: null,
      mfaVerifiedAt: null,
      mfaFactorVersion: null,
      mfaMethod: null,
      lastActivityAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  saveManagementLoginChallenge(
    userId: string,
    tokenHash: string,
    ttlMs: number,
  ): ManagementLoginChallenge {
    const challenge: ManagementLoginChallenge = {
      id: randomUUID(),
      userId,
      tokenHash,
      attempts: 0,
      expiresAt: Date.now() + ttlMs,
      consumedAt: null,
    };
    this.managementLoginChallenges.set(tokenHash, challenge);
    return { ...challenge };
  }

  findManagementLoginChallenge(tokenHash: string): ManagementLoginChallenge | undefined {
    const challenge = this.managementLoginChallenges.get(tokenHash);
    return challenge ? { ...challenge } : undefined;
  }

  incrementManagementLoginChallengeAttempt(
    tokenHash: string,
    now: number,
    maxAttempts: number,
  ): boolean {
    const challenge = this.managementLoginChallenges.get(tokenHash);
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.attempts >= maxAttempts
    ) {
      return false;
    }
    challenge.attempts += 1;
    if (challenge.attempts >= maxAttempts) challenge.consumedAt = now;
    return true;
  }

  consumeManagementLoginChallenge(tokenHash: string, now: number): boolean {
    const challenge = this.managementLoginChallenges.get(tokenHash);
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.attempts >= 5
    ) {
      return false;
    }
    challenge.consumedAt = now;
    return true;
  }

  touchSessionActivity(sessionId: string, at: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= Date.now()) {
      throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    }
    session.lastActivityAt = at;
  }

  findSession(tokenHash: string): Session | undefined {
    return [...this.sessions.values()].find(
      (session) =>
        session.tokenHash === tokenHash && !session.revokedAt && session.expiresAt > Date.now(),
    );
  }

  updateSessionMfa(
    sessionId: string,
    proof: { verifiedAt: string; factorVersion: number; method: 'totp' | 'recovery' },
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= Date.now()) {
      throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    }
    session.mfaVerifiedAt = Date.parse(proof.verifiedAt);
    session.mfaFactorVersion = proof.factorVersion;
    session.mfaMethod = proof.method;
  }

  clearSessionMfa(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.mfaVerifiedAt = null;
      session.mfaFactorVersion = null;
      session.mfaMethod = null;
    }
  }

  revokeSession(tokenHash: string): void {
    const session = [...this.sessions.values()].find((item) => item.tokenHash === tokenHash);
    if (session) session.revokedAt = Date.now();
  }

  listBranches(): Branch[] {
    return [...this.branches.values()].filter((branch) => branch.isActive);
  }

  getBranch(branchId: string): Branch {
    const branch = this.branches.get(branchId);
    if (!branch || !branch.isActive) throw new DomainError('NOT_FOUND', 'شعبه پیدا نشد.');
    return branch;
  }

  createHousehold(input: CreateHouseholdInput, correlationId: string): Household {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new DomainError('VALIDATION_ERROR', 'نام خانواده باید بین ۲ تا ۸۰ نویسه باشد.');
    }

    const household: Household = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      name,
      createdAt: new Date().toISOString(),
    };
    this.households.set(household.id, household);
    const ownerMember: HouseholdMember = {
      id: randomUUID(),
      householdId: household.id,
      userId: input.ownerUserId,
      displayName: this.getUser(input.ownerUserId).displayName ?? 'سرپرست خانواده',
      relationship: 'parent',
      birthDate: null,
      isDependent: false,
    };
    this.householdMembers.set(ownerMember.id, ownerMember);
    this.ensureWallet(household.id);
    this.recordAudit(
      input.ownerUserId,
      'household.created',
      'household',
      household.id,
      correlationId,
    );
    this.recordEvent(
      createEventEnvelope({
        eventType: eventTypes.householdCreated,
        sourceId: 'api-gateway',
        aggregateId: household.id,
        correlationId,
        payload: { householdId: household.id, ownerUserId: input.ownerUserId },
      }),
    );
    return household;
  }

  listHouseholdsForUser(userId: string): Household[] {
    return [...this.households.values()].filter((household) => {
      if (household.ownerUserId === userId) return true;
      return [...this.householdMembers.values()].some(
        (member) => member.householdId === household.id && member.userId === userId,
      );
    });
  }

  getHouseholdForUser(householdId: string, userId: string): Household {
    const household = this.households.get(householdId);
    if (!household) throw new DomainError('NOT_FOUND', 'خانواده پیدا نشد.');
    const allowed =
      household.ownerUserId === userId ||
      [...this.householdMembers.values()].some(
        (member) => member.householdId === householdId && member.userId === userId,
      );
    if (!allowed) throw new DomainError('FORBIDDEN', 'به این خانواده دسترسی ندارید.');
    return household;
  }

  listMembers(householdId: string): HouseholdMember[] {
    return [...this.householdMembers.values()].filter(
      (member) => member.householdId === householdId,
    );
  }

  addMember(input: CreateMemberInput, actorUserId: string, correlationId: string): HouseholdMember {
    this.getHouseholdForUser(input.householdId, actorUserId);
    const name = input.displayName.trim();
    if (name.length < 2 || name.length > 80) {
      throw new DomainError('VALIDATION_ERROR', 'نام عضو باید بین ۲ تا ۸۰ نویسه باشد.');
    }
    const member: HouseholdMember = {
      id: randomUUID(),
      householdId: input.householdId,
      userId: null,
      displayName: name,
      relationship: input.relationship.trim().slice(0, 40),
      birthDate: input.birthDate ?? null,
      isDependent: input.isDependent ?? true,
    };
    this.householdMembers.set(member.id, member);
    this.recordAudit(
      actorUserId,
      'household.member_added',
      'household_member',
      member.id,
      correlationId,
    );
    return member;
  }

  listCardsForUser(userId: string): Card[] {
    const householdIds = new Set(
      this.listHouseholdsForUser(userId).map((household) => household.id),
    );
    return [...this.cards.values()].filter((card) => householdIds.has(card.householdId));
  }

  getCardWallet(cardId: string): WalletAccount | undefined {
    return [...this.wallets.values()].find((wallet) => wallet.cardId === cardId);
  }

  getCardByExternalId(externalCardId: string): Card | undefined {
    const cardId = this.cardsByExternalId.get(externalCardId);
    return cardId ? this.cards.get(cardId) : undefined;
  }

  markCardSynced(externalCardId: string, syncedAt: string): void {
    const card = this.getCardByExternalId(externalCardId);
    if (!card) return;
    card.status = 'active';
    card.lastSyncedAt = syncedAt;
  }

  linkCard(input: {
    householdId: string;
    memberId?: string | null;
    branchId: string;
    externalCardId: string;
    actorUserId: string;
    correlationId: string;
  }): Card {
    this.getHouseholdForUser(input.householdId, input.actorUserId);
    this.getBranch(input.branchId);
    const externalCardId = input.externalCardId.trim();
    if (externalCardId.length < 4 || externalCardId.length > 80) {
      throw new DomainError('VALIDATION_ERROR', 'شناسه‌ی کارت معتبر نیست.');
    }
    const existingId = this.cardsByExternalId.get(externalCardId);
    if (existingId) {
      const existing = this.cards.get(existingId)!;
      if (existing.householdId === input.householdId) return existing;
      throw new DomainError('CONFLICT', 'این کارت قبلاً به خانواده‌ی دیگری متصل شده است.');
    }
    if (input.memberId) {
      const member = this.householdMembers.get(input.memberId);
      if (!member || member.householdId !== input.householdId) {
        throw new DomainError('VALIDATION_ERROR', 'عضو انتخاب‌شده متعلق به این خانواده نیست.');
      }
    }
    const card: Card = {
      id: randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId ?? null,
      branchId: input.branchId,
      externalCardId,
      status: 'pending_sync',
      lastSyncedAt: null,
    };
    this.cards.set(card.id, card);
    this.cardsByExternalId.set(externalCardId, card.id);
    this.ensureWallet(input.householdId, card.id);
    this.recordAudit(
      input.actorUserId,
      'card.link_requested',
      'card',
      card.id,
      input.correlationId,
    );
    this.recordEvent(
      createEventEnvelope({
        eventType: eventTypes.cardLinked,
        sourceId: 'api-gateway',
        aggregateId: card.id,
        correlationId: input.correlationId,
        branchId: card.branchId,
        payload: {
          cardId: card.id,
          householdId: card.householdId,
          memberId: card.memberId,
          branchId: card.branchId,
          externalCardId: card.externalCardId,
        },
      }),
    );
    return card;
  }

  ensureWallet(householdId: string, cardId: string | null = null): WalletAccount {
    const existing = [...this.wallets.values()].find(
      (wallet) => wallet.householdId === householdId && wallet.cardId === cardId,
    );
    if (existing) return existing;
    const wallet: WalletAccount = {
      id: randomUUID(),
      householdId,
      cardId,
      currency: 'IRR',
    };
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  getWalletForUser(walletId: string, userId: string): WalletAccount {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new DomainError('NOT_FOUND', 'کیف پول پیدا نشد.');
    this.getHouseholdForUser(wallet.householdId, userId);
    return wallet;
  }

  listWalletsForUser(userId: string): WalletAccount[] {
    const householdIds = new Set(
      this.listHouseholdsForUser(userId).map((household) => household.id),
    );
    return [...this.wallets.values()].filter((wallet) => householdIds.has(wallet.householdId));
  }

  listLedgerEntries(walletId: string): LedgerEntry[] {
    return [...this.ledgerEntries.values()]
      .filter((entry) => entry.walletId === walletId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  applyWalletLedgerEntry(input: {
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
  }): { entry: LedgerEntry; created: boolean } {
    const existing = [...this.ledgerEntries.values()].find(
      (entry) => entry.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { entry: existing, created: false };
    if (!this.wallets.has(input.walletId)) {
      throw new DomainError('NOT_FOUND', 'Wallet not found.');
    }
    const entry: LedgerEntry = {
      id: randomUUID(),
      walletId: input.walletId,
      assetType: input.assetType,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      occurredAt: input.occurredAt,
    };
    this.ledgerEntries.set(entry.id, entry);
    this.recordEvent(
      createEventEnvelope({
        eventType: eventTypes.walletCredited,
        sourceId: 'wallet',
        aggregateId: input.walletId,
        correlationId: input.correlationId,
        organizationId: input.organizationId,
        branchId: input.branchId,
        payload: {
          ledgerEntryId: entry.id,
          walletId: entry.walletId,
          assetType: entry.assetType,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        },
      }),
    );
    return { entry, created: true };
  }

  getProgress(missionId: string, householdId: string): MissionProgress | undefined {
    return this.progress.get(`${missionId}:${householdId}`);
  }

  listMissions(branchId?: string): Mission[] {
    const now = Date.now();
    return [...this.missions.values()].filter((mission) => {
      if (!['published', 'active'].includes(mission.status)) return false;
      if (mission.branchId && branchId && mission.branchId !== branchId) return false;
      if (new Date(mission.startsAt).getTime() > now) return false;
      return !mission.endsAt || new Date(mission.endsAt).getTime() > now;
    });
  }

  claimMission(input: {
    missionId: string;
    householdId: string;
    actorUserId: string;
    correlationId: string;
  }): { mission: Mission; progress: MissionProgress; alreadyClaimed: boolean } {
    this.getHouseholdForUser(input.householdId, input.actorUserId);
    const mission = this.missions.get(input.missionId);
    if (
      !mission ||
      !this.listMissions(mission.branchId ?? undefined).some((item) => item.id === mission.id)
    ) {
      throw new DomainError('NOT_FOUND', 'مأموریت فعال پیدا نشد.');
    }
    const key = `${input.missionId}:${input.householdId}`;
    const existing = this.progress.get(key);
    if (existing?.claimedAt) return { mission, progress: existing, alreadyClaimed: true };

    const progress: MissionProgress = existing ?? {
      missionId: input.missionId,
      householdId: input.householdId,
      progress: 100,
      completedAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
    };
    progress.progress = 100;
    progress.completedAt = progress.completedAt ?? new Date().toISOString();
    progress.claimedAt = new Date().toISOString();
    this.progress.set(key, progress);
    this.recordAudit(
      input.actorUserId,
      'mission.claimed',
      'mission',
      mission.id,
      input.correlationId,
    );
    this.recordEvent(
      createEventEnvelope({
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
      }),
    );
    return { mission, progress, alreadyClaimed: false };
  }

  recordAudit(
    actorUserId: string | null,
    action: string,
    resourceType: string,
    resourceId: string,
    correlationId: string,
    reason: string | null = null,
    scope?: { organizationId?: string | null; branchId?: string | null },
  ): void {
    this.audits.push({
      id: randomUUID(),
      actorUserId,
      action,
      resourceType,
      resourceId,
      organizationId: scope?.organizationId ?? null,
      branchId: scope?.branchId ?? null,
      correlationId,
      reason,
      createdAt: new Date().toISOString(),
    });
  }

  consumeOperationsCustomerLookupQuota(input: {
    actorUserId: string;
    branchId: string;
    windowStartedAt: number;
    maxRequests: number;
  }): number {
    const key = `${input.actorUserId.toLowerCase()}:${input.branchId.toLowerCase()}`;
    const current = this.customerLookupQuotas.get(key);
    const count =
      current?.windowStartedAt === input.windowStartedAt
        ? Math.min(current.count + 1, input.maxRequests + 1)
        : 1;
    this.customerLookupQuotas.set(key, { windowStartedAt: input.windowStartedAt, count });
    return count;
  }

  private recordEvent(event: EventEnvelope): void {
    this.outbox.set(event.eventId, event);
  }

  takePendingEvents(): EventEnvelope[] {
    const pending = [...this.outbox.values()];
    for (const event of pending) this.outbox.delete(event.eventId);
    return pending;
  }

  requeueEvents(events: EventEnvelope[]): void {
    for (const event of events) this.outbox.set(event.eventId, event);
  }

  ackEvents(): void {
    // In-memory takePendingEvents removes events immediately. The PostgreSQL adapter
    // acknowledges them explicitly after RabbitMQ confirms publication.
  }
}

function cleanOptional(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function cleanEmail(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function isProfileComplete(user: User, hasAvatar: boolean): boolean {
  return Boolean(
    user.firstName &&
      user.lastName &&
      user.birthDate &&
      user.gender &&
      user.city &&
      (hasAvatar || user.avatarPreset),
  );
}
