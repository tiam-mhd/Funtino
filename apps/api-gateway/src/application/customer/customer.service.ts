import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import type {
  Branch,
  User,
  UserAvatar,
  UserProfileUpdate,
  WalletAccount,
} from '../../domain/models.js';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import { CustomerHouseholdClient } from '../../infrastructure/customer-household/customer-household.client.js';
import {
  WalletClient,
  type WalletCardLifecycleAction,
} from '../../infrastructure/wallet/wallet.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { DeviceIntegrationClient } from '../../infrastructure/device-integration/device-integration.client.js';
import { isCustomerProfileOwnerEnabled } from './customer-profile-ownership.js';

const customerBalanceLookupBucketId = '00000000-0000-4000-8000-000000000001';
const customerBalanceLookupWindowMs = 15 * 60 * 1000;
const customerBalanceLookupMaxRequests = 10;

@Injectable()
export class CustomerService {
  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly householdOwner: CustomerHouseholdClient,
    private readonly wallet: WalletClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly devices: DeviceIntegrationClient,
  ) {}

  async getHome(userId: string, branchId?: string) {
    const branches = await this.organizationBranch.listActiveBranches();
    const households = await this.householdOwner.listHouseholdsForUser(userId);
    const cards = await this.listCards(userId);
    const accessibleBranchIds = new Set(
      cards.map((card) => card.branchId).filter((value): value is string => Boolean(value)),
    );
    if (branchId && !accessibleBranchIds.has(branchId)) {
      throw new DomainError('FORBIDDEN', 'این شعبه به هیچ‌یک از کارت‌های مشتری متصل نیست.');
    }
    const activeBranch = branchId
      ? await this.organizationBranch.getActiveBranch(branchId)
      : undefined;
    const wallets = await this.store.listWalletsForUser(userId);
    const missions = activeBranch ? await this.store.listMissions(activeBranch.id) : [];
    const householdsWithMembers = households.map((household) => ({
      id: household.id,
      name: household.name,
      members: household.members.map(({ id, displayName }) => ({ id, displayName })),
    }));
    const presentedCards = cards;
    const presentedWallets = await Promise.all(wallets.map((wallet) => this.presentWallet(wallet)));
    const presentedMissions = await Promise.all(
      missions.map(async (mission) => ({
        ...mission,
        progress: households[0]
          ? ((await this.store.getProgress(mission.id, households[0].id)) ?? null)
          : null,
      })),
    );

    return {
      activeBranch: presentBranch(activeBranch),
      branches: branches.map(presentBranch),
      linkedBranches: branches
        .filter((branch) => accessibleBranchIds.has(branch.id))
        .map(presentBranch),
      households: householdsWithMembers,
      cards: presentedCards,
      wallets: presentedWallets,
      missions: presentedMissions,
      dataStatus:
        process.env.STORAGE_MODE === 'postgres' ? 'postgres-backed' : 'memory-backed-development',
      // Wallet assignments currently carry no authoritative device-sync timestamp.
      lastSyncedAt: null,
    };
  }

  async listBranches() {
    return (await this.organizationBranch.listActiveBranches()).map(presentBranch);
  }

  async getBranch(branchId: string) {
    return presentBranch(await this.organizationBranch.getActiveBranch(branchId));
  }

  async getProfile(userId: string) {
    if (!isCustomerProfileOwnerEnabled()) {
      return presentLegacyProfile(
        await this.store.getUser(userId),
        await this.store.getUserAvatar(userId),
      );
    }
    const [user, profile] = await Promise.all([
      this.store.getUser(userId),
      this.householdOwner.getCustomerProfile(userId),
    ]);
    return presentProfile(user, profile);
  }

  async updateProfile(userId: string, input: UserProfileUpdate, correlationId: string) {
    if (!isCustomerProfileOwnerEnabled()) {
      const user = await this.store.updateUserProfile(userId, input);
      await this.store.recordAudit(
        userId,
        'customer.profile_updated',
        'user',
        userId,
        correlationId,
      );
      return presentLegacyProfile(user, await this.store.getUserAvatar(userId));
    }
    const [user, profile] = await Promise.all([
      this.store.getUser(userId),
      this.householdOwner.updateCustomerProfile(userId, input, {
        correlationId,
        idempotencyKey: correlationId,
      }),
    ]);
    return presentProfile(user, profile);
  }

  async saveAvatar(
    userId: string,
    input: { mimeType: string; data: Buffer },
    correlationId: string,
  ) {
    if (!isCustomerProfileOwnerEnabled()) {
      const user = await this.store.saveUserAvatar({ userId, ...input });
      await this.store.recordAudit(
        userId,
        'customer.avatar_updated',
        'user_avatar',
        userId,
        correlationId,
      );
      return presentLegacyProfile(user, await this.store.getUserAvatar(userId));
    }
    const [user, profile] = await Promise.all([
      this.store.getUser(userId),
      this.householdOwner.saveCustomerAvatar(userId, input, {
        correlationId,
        idempotencyKey: correlationId,
      }),
    ]);
    return presentProfile(user, profile);
  }

  async getAvatar(userId: string): Promise<UserAvatar> {
    const avatar = isCustomerProfileOwnerEnabled()
      ? await this.householdOwner.getCustomerAvatar(userId)
      : await this.store.getUserAvatar(userId);
    if (!avatar) {
      throw new DomainError('NOT_FOUND', 'تصویر پروفایل پیدا نشد.');
    }
    return avatar;
  }

  async listHouseholds(userId: string) {
    const households = await this.householdOwner.listHouseholdsForUser(userId);
    return households.map((household) => ({
      id: household.id,
      name: household.name,
      members: household.members.map(({ id, displayName }) => ({ id, displayName })),
    }));
  }

  async createHousehold(
    userId: string,
    name: string,
    correlationId: string,
    idempotencyKey: string,
  ) {
    const household = await this.householdOwner.createHousehold(userId, name, {
      correlationId,
      idempotencyKey,
    });
    return { ...household, members: [] };
  }

  async addMember(
    userId: string,
    householdId: string,
    input: {
      displayName: string;
      relationship: string;
      birthDate?: string | null;
      isDependent?: boolean;
    },
    correlationId: string,
    idempotencyKey: string,
  ) {
    return this.householdOwner.addMember(userId, householdId, input, {
      correlationId,
      idempotencyKey,
    });
  }

  async listCards(userId: string) {
    const households = await this.householdOwner.listHouseholdsForUser(userId);
    const assignments = await Promise.all(
      households.map((household) => this.wallet.listHouseholdAssignments(household.id)),
    );
    return Promise.all(
      assignments.flatMap((items) =>
        items.map(async (item) => {
          const summary = await this.wallet.getCardLedgerSummary(item.householdId, item.cardId);
          return {
            id: item.cardId,
            householdId: item.householdId,
            memberId: item.memberId,
            branchId: item.branchId,
            maskedCardId: `•••• •••• ${item.maskedIdentifier.slice(-4)}`,
            status: item.status === 'assigned' ? ('active' as const) : ('blocked' as const),
            lastSyncedAt: summary.lastConfirmedSnapshotAt,
            walletId: null,
            isStale: summary.freshness !== 'fresh',
            freshness: summary.freshness,
            balanceRial: summary.balanceRial,
            pendingTransactionCount: summary.pendingTransactionCount,
          };
        }),
      ),
    );
  }

  async lookupCardBalance(userId: string, cardUidHash: string) {
    const now = Date.now();
    const lookupCount = await this.store.consumeOperationsCustomerLookupQuota({
      actorUserId: userId,
      branchId: customerBalanceLookupBucketId,
      windowStartedAt:
        Math.floor(now / customerBalanceLookupWindowMs) * customerBalanceLookupWindowMs,
      maxRequests: customerBalanceLookupMaxRequests,
    });
    if (lookupCount > customerBalanceLookupMaxRequests) {
      throw new DomainError(
        'RATE_LIMITED',
        'درخواست‌های بررسی موجودی زیاد شده است؛ کمی بعد دوباره تلاش کن.',
      );
    }

    const households = await this.householdOwner.listHouseholdsForUser(userId);
    if (households.length === 0) return { status: 'unavailable' as const };
    return this.wallet.lookupCardBalanceByHash({
      cardUidHash,
      audience: { type: 'customer', householdIds: households.map((household) => household.id) },
    });
  }

  async listCardTransactions(
    userId: string,
    householdId: string,
    cardId: string,
    query: {
      cursor?: string;
      pageSize: number;
      kind?: 'top_up' | 'spend' | 'refund' | 'adjustment' | 'issuance' | 'card_replacement';
      from?: string;
      to?: string;
    },
  ) {
    const households = await this.householdOwner.listHouseholdsForUser(userId);
    if (!households.some((household) => household.id.toLowerCase() === householdId.toLowerCase())) {
      throw new DomainError('FORBIDDEN', 'Household access is required.');
    }
    const assignments = await this.wallet.listHouseholdAssignments(householdId);
    const assignment = assignments.find(
      (item) => item.cardId.toLowerCase() === cardId.toLowerCase(),
    );
    if (!assignment) {
      throw new DomainError('NOT_FOUND', 'Card assignment not found.');
    }
    const page = await this.wallet.listCardLedgerTransactions({ householdId, cardId, ...query });
    const devicePage = await this.devices.listDevices({
      organizationId: assignment.organizationId,
      branchId: assignment.branchId,
      status: 'active',
      pageSize: 100,
    });
    const deviceNames = new Map(
      devicePage.items.map((device) => [device.id.toLowerCase(), device.displayName]),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        deviceName: item.deviceId ? (deviceNames.get(item.deviceId.toLowerCase()) ?? null) : null,
      })),
    };
  }

  async listCardLifecycleRequests(userId: string, householdId: string, cardId: string) {
    await this.assertHouseholdCardAccess(userId, householdId, cardId);
    return this.wallet.listCardLifecycleRequests(householdId, cardId);
  }

  async createCardLifecycleRequest(input: {
    userId: string;
    householdId: string;
    cardId: string;
    action: WalletCardLifecycleAction;
    reason: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    await this.assertHouseholdCardAccess(input.userId, input.householdId, input.cardId);
    return this.wallet.createCardLifecycleRequest(
      {
        householdId: input.householdId,
        cardId: input.cardId,
        action: input.action,
        reason: input.reason,
      },
      {
        actorUserId: input.userId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
      },
    );
  }

  private async assertHouseholdCardAccess(userId: string, householdId: string, cardId: string) {
    const households = await this.householdOwner.listHouseholdsForUser(userId);
    if (!households.some((household) => household.id.toLowerCase() === householdId.toLowerCase()))
      throw new DomainError('FORBIDDEN', 'Household access is required.');
    const assignments = await this.wallet.listHouseholdAssignments(householdId);
    const assignment = assignments.find(
      (item) => item.cardId.toLowerCase() === cardId.toLowerCase(),
    );
    if (!assignment) throw new DomainError('NOT_FOUND', 'Card assignment not found.');
    return assignment;
  }

  async linkCard(
    userId: string,
    input: {
      householdId: string;
      memberId?: string | null;
      branchId: string;
      externalCardId: string;
    },
    correlationId: string,
  ) {
    void userId;
    void input;
    void correlationId;
    throw new DomainError('CONFLICT', 'تخصیص کارت باید از پنل مجاز همان شعبه انجام شود.');
  }

  async walletSummary(userId: string, walletId: string) {
    const wallet = await this.store.getWalletForUser(walletId, userId);
    const entries = await this.store.listLedgerEntries(wallet.id);
    const balances = new Map<string, number>();
    for (const entry of entries) {
      balances.set(entry.assetType, (balances.get(entry.assetType) ?? 0) + entry.amountMinor);
    }
    return {
      wallet,
      balances: {
        purchasedCreditMinor: balances.get('purchased_credit') ?? 0,
        giftCreditMinor: balances.get('gift_credit') ?? 0,
        loyaltyPoints: balances.get('loyalty_points') ?? 0,
      },
      currency: wallet.currency,
      entries: entries.slice(0, 50),
      freshness: 'not-synced',
      lastSyncedAt: null,
    };
  }

  async walletTransactions(userId: string, walletId: string) {
    const wallet = await this.store.getWalletForUser(walletId, userId);
    return { walletId: wallet.id, items: await this.store.listLedgerEntries(wallet.id) };
  }

  async listMissions(userId: string, branchId?: string) {
    if (!branchId) return [];
    const cards = await this.listCards(userId);
    if (!cards.some((card) => card.branchId === branchId)) {
      throw new DomainError('FORBIDDEN', 'این شعبه به هیچ‌یک از کارت‌های مشتری متصل نیست.');
    }
    const households = await this.store.listHouseholdsForUser(userId);
    const missions = await this.store.listMissions(branchId);
    return Promise.all(
      missions.map(async (mission) => ({
        ...mission,
        progress: await Promise.all(
          households.map(async (household) => ({
            ...((await this.store.getProgress(mission.id, household.id)) ?? {
              progress: 0,
              completedAt: null,
              claimedAt: null,
            }),
            householdId: household.id,
          })),
        ),
      })),
    );
  }

  async claimMission(
    userId: string,
    missionId: string,
    householdId: string,
    correlationId: string,
  ) {
    const cards = await this.listCards(userId);
    const branchIds = [
      ...new Set(
        cards.map((card) => card.branchId).filter((value): value is string => Boolean(value)),
      ),
    ];
    const availableMissions = await Promise.all(
      branchIds.map((branchId) => this.store.listMissions(branchId)),
    );
    if (!availableMissions.flat().some((mission) => mission.id === missionId)) {
      throw new DomainError('FORBIDDEN', 'این مأموریت برای کارت‌های متصل شما فعال نیست.');
    }
    return this.store.claimMission({
      missionId,
      householdId,
      actorUserId: userId,
      correlationId,
    });
  }

  private async presentWallet(wallet: WalletAccount) {
    const entries = await this.store.listLedgerEntries(wallet.id);
    const balance = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
    return {
      ...wallet,
      totalMinor: balance,
      freshness: 'not-synced',
      lastSyncedAt: null,
    };
  }
}

function presentBranch(branch: Branch | undefined) {
  if (!branch) return null;
  return {
    ...branch,
    status: branch.isActive ? 'open' : 'closed',
    todayHours: branch.openingHours.friday ?? null,
  };
}

function presentLegacyProfile(user: User, avatar: UserAvatar | undefined) {
  return {
    ...user,
    avatarUrl: avatar ? '/api/v1/customer/profile/avatar' : null,
    avatarUpdatedAt: avatar?.updatedAt ?? null,
    profileCompleted: Boolean(user.profileCompletedAt),
  };
}

function presentProfile(
  user: User,
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    birthDate: string | null;
    gender: string | null;
    city: string | null;
    avatarPreset: string | null;
    hasUploadedAvatar: boolean;
    avatarUpdatedAt: string | null;
    profileCompletedAt: string | null;
    profileCompleted: boolean;
    version: number;
  },
) {
  return {
    ...user,
    displayName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    birthDate: profile.birthDate,
    gender: profile.gender,
    city: profile.city,
    avatarPreset: profile.avatarPreset,
    profileCompletedAt: profile.profileCompletedAt,
    avatarUrl: profile.hasUploadedAvatar ? '/api/v1/customer/profile/avatar' : null,
    avatarUpdatedAt: profile.avatarUpdatedAt,
    profileCompleted: profile.profileCompleted,
    profileVersion: profile.version,
  };
}
