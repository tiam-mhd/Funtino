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
import { WalletClient } from '../../infrastructure/wallet/wallet.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';

@Injectable()
export class CustomerService {
  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly householdOwner: CustomerHouseholdClient,
    private readonly wallet: WalletClient,
    private readonly organizationBranch: OrganizationBranchClient,
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
    const user = await this.store.getUser(userId);
    const avatar = await this.store.getUserAvatar(userId);
    return presentProfile(user, avatar);
  }

  async updateProfile(userId: string, input: UserProfileUpdate, correlationId: string) {
    const user = await this.store.updateUserProfile(userId, input);
    await this.store.recordAudit(userId, 'customer.profile_updated', 'user', userId, correlationId);
    const avatar = await this.store.getUserAvatar(userId);
    return presentProfile(user, avatar);
  }

  async saveAvatar(
    userId: string,
    input: { mimeType: string; data: Buffer },
    correlationId: string,
  ) {
    const user = await this.store.saveUserAvatar({ userId, ...input });
    await this.store.recordAudit(
      userId,
      'customer.avatar_updated',
      'user_avatar',
      userId,
      correlationId,
    );
    return presentProfile(user, await this.store.getUserAvatar(userId));
  }

  async getAvatar(userId: string): Promise<UserAvatar> {
    const avatar = await this.store.getUserAvatar(userId);
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
    return assignments.flatMap((items) =>
      items.map((item) => ({
        id: item.cardId,
        householdId: item.householdId,
        memberId: null,
        branchId: item.branchId,
        maskedCardId: `•••• •••• ${item.maskedIdentifier.slice(-4)}`,
        status: item.status === 'assigned' ? ('active' as const) : ('blocked' as const),
        lastSyncedAt: null,
        walletId: null,
        isStale: true,
        freshness: 'unknown' as const,
      })),
    );
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

function presentProfile(user: User, avatar: UserAvatar | undefined) {
  return {
    ...user,
    avatarUrl: avatar ? '/api/v1/customer/profile/avatar' : null,
    avatarUpdatedAt: avatar?.updatedAt ?? null,
    profileCompleted: Boolean(user.profileCompletedAt),
  };
}
