export type User = {
  id: string;
  phoneE164: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  city: string | null;
  avatarPreset: string | null;
  profileCompletedAt: string | null;
  createdAt: string;
};

export type UserProfileUpdate = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  city?: string | null;
  avatarPreset?: string | null;
};

export type UserAvatar = {
  userId: string;
  mimeType: string;
  data: Buffer;
  updatedAt: string;
};

export type OtpChallenge = {
  id: string;
  phoneE164: string;
  codeHash: string;
  attempts: number;
  expiresAt: number;
  consumedAt: number | null;
};

export type Session = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt: number | null;
  mfaVerifiedAt: number | null;
  mfaFactorVersion: number | null;
  mfaMethod: 'totp' | 'recovery' | null;
  isSystemAdmin: boolean;
  mfaLoginDeadlineAt: number | null;
  lastActivityAt: number;
};

export type Branch = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  timezone: string;
  isActive: boolean;
  openingHours: Record<string, { open: string; close: string } | null>;
};

export type Household = {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
};

export type HouseholdMember = {
  id: string;
  householdId: string;
  userId: string | null;
  displayName: string;
  relationship: string;
  birthDate: string | null;
  isDependent: boolean;
};

export type Card = {
  id: string;
  householdId: string;
  memberId: string | null;
  branchId: string | null;
  externalCardId: string;
  status: 'pending_sync' | 'active' | 'blocked' | 'unlinked';
  lastSyncedAt: string | null;
};

export type WalletAccount = {
  id: string;
  householdId: string;
  cardId: string | null;
  currency: string;
};

export type LedgerEntry = {
  id: string;
  walletId: string;
  assetType: 'purchased_credit' | 'gift_credit' | 'loyalty_points';
  kind: 'top_up' | 'spend' | 'refund' | 'adjustment' | 'reward' | 'expiry';
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  source: string;
  occurredAt: string;
};

export type Mission = {
  id: string;
  organizationId: string | null;
  branchId: string | null;
  title: string;
  description: string;
  status: 'draft' | 'published' | 'active' | 'expired';
  rewardType: 'loyalty_points' | 'coupon' | 'gift_credit';
  rewardValue: number;
  startsAt: string;
  endsAt: string | null;
};

export type MissionProgress = {
  missionId: string;
  householdId: string;
  progress: number;
  completedAt: string | null;
  claimedAt: string | null;
};

export type AuditRecord = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  organizationId: string | null;
  branchId: string | null;
  correlationId: string;
  reason: string | null;
  createdAt: string;
};
