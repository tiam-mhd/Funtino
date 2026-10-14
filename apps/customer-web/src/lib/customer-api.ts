export type CustomerUser = {
  id: string;
  phoneE164: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthDate: string | null;
  gender: CustomerGender | null;
  city: string | null;
  avatarPreset: AvatarPreset | null;
  avatarUrl: string | null;
  avatarUpdatedAt?: string | null;
  profileCompletedAt: string | null;
  profileCompleted: boolean;
  createdAt: string;
};

export type AvatarPreset = 'sun' | 'star' | 'rainbow' | 'rocket' | 'crown' | 'bear' | 'cat' | 'fox';
export type CustomerGender = 'female' | 'male' | 'other' | 'prefer_not_to_say';

export type CustomerProfileUpdate = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  birthDate?: string | null;
  gender?: CustomerGender | null;
  city?: string | null;
  avatarPreset?: AvatarPreset | null;
};

export type OtpRequestResult = {
  challengeId: string;
  expiresAt: string;
  deliveryStatus?: 'confirmed' | 'unknown';
  devCode?: string;
};

export type CustomerCard = {
  id: string;
  householdId: string;
  memberId: null;
  branchId: string | null;
  maskedCardId: string;
  status: 'pending_sync' | 'active' | 'blocked' | 'unlinked';
  lastSyncedAt: string | null;
  walletId: string | null;
  isStale: boolean;
  freshness: 'fresh' | 'stale' | 'unknown';
};

export type CustomerHouseholdSummary = {
  id: string;
  name: string;
  members: Array<{ id: string; displayName: string }>;
};

export type CustomerFamilyRelationshipKind =
  | 'parent_of'
  | 'spouse_of'
  | 'sibling_of'
  | 'guardian_of';
export type CustomerFamilyRelationshipBasis =
  | 'biological'
  | 'legal'
  | 'adoptive'
  | 'step'
  | 'partner'
  | 'unspecified';
export type CustomerFamilyInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired'
  | 'claim_pending'
  | 'linked'
  | 'conflict_review';

export type CustomerFamilyInvitation = {
  id: string;
  householdId: string;
  memberId: string;
  kind: 'adult_account' | 'dependent_claim';
  status: CustomerFamilyInvitationStatus;
  expiresAt: string | null;
  createdAt: string;
  householdName?: string;
  memberName?: string;
};

export type CustomerFamilyMember = {
  id: string;
  householdId: string;
  displayName: string;
  relationship: string;
  relationshipLabel: string;
  relationshipStatus: 'verified' | 'ambiguous' | 'needs_review';
  displayGender: 'female' | 'male' | 'unspecified' | null;
  isAccountLinked: boolean;
  isViewer: boolean;
  birthDate: string | null;
  status: 'active' | 'pending' | 'archived';
  isDependent: boolean;
  version: number;
  createdAt: string;
};

export type CustomerFamilyHousehold = {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
  version: number;
  createdAt: string;
  accessRole: 'owner' | 'guardian' | 'member';
  canManage: boolean;
  viewerMemberId: string | null;
  members: CustomerFamilyMember[];
  relationships: Array<{
    id?: string;
    fromMemberId: string;
    toMemberId: string;
    kind: CustomerFamilyRelationshipKind;
    basis: CustomerFamilyRelationshipBasis;
  }>;
  invitations: CustomerFamilyInvitation[];
};

export type CustomerFamilyData = {
  items: CustomerFamilyHousehold[];
  invitations: CustomerFamilyInvitation[];
};

export type CustomerCreatedFamilyMember = {
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

export type AddCustomerFamilyMemberInput = {
  displayName: string;
  relativeMemberId?: string | 'viewer' | null;
  relationship: 'parent' | 'child' | 'spouse' | 'sibling' | 'guardian' | 'ward';
  basis: CustomerFamilyRelationshipBasis;
  displayGender?: 'female' | 'male' | 'unspecified';
  birthDate?: string | null;
  isDependent: boolean;
  phone?: string;
  createClaimLink?: boolean;
};
export type UpdateCustomerFamilyMemberInput = {
  expectedVersion: number;
  displayName?: string;
  displayGender?: 'female' | 'male' | 'unspecified' | null;
  birthDate?: string | null;
  relationshipId?: string;
  relativeMemberId?: string;
  relationship?: AddCustomerFamilyMemberInput['relationship'];
  basis?: AddCustomerFamilyMemberInput['basis'];
};

export type CustomerBranchSummary = {
  id: string;
  name: string;
  status: 'open' | 'closed';
};

export class CustomerApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CustomerApiError';
  }
}

export const customerApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4000';

export async function requestOtp(phone: string): Promise<OtpRequestResult> {
  return apiFetch<OtpRequestResult>('/api/v1/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export async function verifyOtp(input: {
  challengeId: string;
  phone: string;
  code: string;
}): Promise<{ user: CustomerUser; expiresAt: string }> {
  return apiFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getMe(): Promise<CustomerUser> {
  return apiFetch<CustomerUser>('/api/v1/auth/me');
}

export function getProfile(): Promise<CustomerUser> {
  return apiFetch<CustomerUser>('/api/v1/customer/profile');
}

export function getCustomerCards(): Promise<CustomerCard[]> {
  return apiFetch<unknown>('/api/v1/customer/cards').then(parseCustomerCards);
}

export function getCustomerHouseholds(): Promise<CustomerHouseholdSummary[]> {
  return apiFetch<unknown>('/api/v1/customer/households').then(parseCustomerHouseholds);
}

export function getCustomerFamily(): Promise<CustomerFamilyData> {
  return apiFetch<CustomerFamilyData>('/api/v1/customer/family', { cache: 'no-store' });
}

export function createCustomerHousehold(name: string) {
  return apiFetch<{
    id: string;
    name: string;
    status: string;
    version: number;
    createdAt: string;
    members: [];
  }>('/api/v1/customer/households', {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ name }),
  });
}

export function addCustomerFamilyMember(
  householdId: string,
  input: AddCustomerFamilyMemberInput,
  idempotencyKey = crypto.randomUUID(),
) {
  return apiFetch<{
    member: CustomerCreatedFamilyMember;
    relationship: CustomerFamilyHousehold['relationships'][number] | null;
    invitation: (CustomerFamilyInvitation & { shareToken?: string }) | null;
  }>(`/api/v1/customer/family/households/${encodeURIComponent(householdId)}/members`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });
}

export function updateCustomerFamilyMember(
  householdId: string,
  memberId: string,
  input: UpdateCustomerFamilyMemberInput,
  idempotencyKey = crypto.randomUUID(),
) {
  return apiFetch<CustomerCreatedFamilyMember>(
    `/api/v1/customer/family/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(memberId)}`,
    {
      method: 'PATCH',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export function archiveCustomerFamilyMember(
  householdId: string,
  memberId: string,
  expectedVersion: number,
  idempotencyKey = crypto.randomUUID(),
) {
  return apiFetch<CustomerCreatedFamilyMember>(
    `/api/v1/customer/family/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(memberId)}/archive`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ expectedVersion }),
    },
  );
}

export function removeCustomerFamilyRelationship(
  householdId: string,
  relationshipId: string,
  input: { memberId: string; expectedVersion: number },
  idempotencyKey = crypto.randomUUID(),
) {
  return apiFetch<{
    relationshipId: string;
    householdId: string;
    memberId: string;
    version: number;
  }>(
    `/api/v1/customer/family/households/${encodeURIComponent(householdId)}/relationships/${encodeURIComponent(relationshipId)}/remove`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export function previewCustomerFamilyInvitation(token: string) {
  return apiFetch<
    | {
        valid: true;
        invitationId: string;
        householdName: string;
        memberName: string;
        kind: 'adult_account' | 'dependent_claim';
        expiresAt: string | null;
      }
    | { valid: false }
  >('/api/v1/customer/family/invitations/preview', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function acceptCustomerFamilyInvitation(input: { token?: string; invitationId?: string }) {
  return apiFetch<CustomerFamilyInvitation>('/api/v1/customer/family/invitations/accept', {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export function linkCustomerFamilyInvitation(invitationId: string) {
  return familyInvitationCommand(invitationId, 'link');
}

export function approveCustomerDependentClaim(invitationId: string) {
  return familyInvitationCommand(invitationId, 'approve-claim');
}

export function declineCustomerFamilyInvitation(invitationId: string) {
  return familyInvitationCommand(invitationId, 'decline');
}

export function revokeCustomerFamilyInvitation(invitationId: string) {
  return familyInvitationCommand(invitationId, 'revoke');
}

function familyInvitationCommand(invitationId: string, action: string) {
  return apiFetch<CustomerFamilyInvitation>(
    `/api/v1/customer/family/invitations/${encodeURIComponent(invitationId)}/${action}`,
    {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({}),
    },
  );
}

export function getCustomerBranches(): Promise<CustomerBranchSummary[]> {
  return apiFetch<unknown>('/api/v1/customer/branches').then(parseCustomerBranches);
}

export function updateProfile(input: CustomerProfileUpdate): Promise<CustomerUser> {
  return apiFetch<CustomerUser>('/api/v1/customer/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function uploadAvatar(file: File): Promise<CustomerUser> {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<CustomerUser>('/api/v1/customer/profile/avatar', {
    method: 'POST',
    body,
  });
}

export async function logout(): Promise<void> {
  await apiFetch('/api/v1/auth/logout', { method: 'POST' });
}

export function avatarSource(profile: CustomerUser, cacheKey?: string): string | null {
  if (!profile.avatarUrl) return null;
  const suffix = cacheKey || profile.avatarUpdatedAt || profile.profileCompletedAt || 'current';
  return `${customerApiBaseUrl}${profile.avatarUrl}?v=${encodeURIComponent(suffix)}`;
}

function parseCustomerCards(value: unknown): CustomerCard[] {
  if (!Array.isArray(value)) throw invalidCustomerResponse();
  return value.map((item) => {
    if (!isRecord(item)) throw invalidCustomerResponse();
    if (
      !isUuid(item.id) ||
      !isUuid(item.householdId) ||
      item.memberId !== null ||
      !isNullableUuid(item.branchId) ||
      !isMaskedCardIdentifier(item.maskedCardId) ||
      !isCardStatus(item.status) ||
      !isNullableDateTime(item.lastSyncedAt) ||
      !isNullableUuid(item.walletId) ||
      typeof item.isStale !== 'boolean' ||
      (item.freshness !== 'fresh' && item.freshness !== 'stale' && item.freshness !== 'unknown')
    ) {
      throw invalidCustomerResponse();
    }
    if (
      (item.freshness === 'unknown' && item.lastSyncedAt !== null) ||
      (item.freshness === 'fresh' && (item.lastSyncedAt === null || item.isStale)) ||
      (item.freshness === 'stale' && (item.lastSyncedAt === null || !item.isStale))
    ) {
      throw invalidCustomerResponse();
    }
    return {
      id: item.id,
      householdId: item.householdId,
      memberId: item.memberId,
      branchId: item.branchId,
      maskedCardId: item.maskedCardId,
      status: item.status,
      lastSyncedAt: item.lastSyncedAt,
      walletId: item.walletId,
      isStale: item.isStale,
      freshness: item.freshness,
    };
  });
}

function parseCustomerHouseholds(value: unknown): CustomerHouseholdSummary[] {
  if (!Array.isArray(value)) throw invalidCustomerResponse();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      !isNonEmptyString(item.name) ||
      !Array.isArray(item.members)
    ) {
      throw invalidCustomerResponse();
    }
    const members = item.members.map((member) => {
      if (!isRecord(member) || !isUuid(member.id) || !isNonEmptyString(member.displayName)) {
        throw invalidCustomerResponse();
      }
      return { id: member.id, displayName: member.displayName.trim() };
    });
    return { id: item.id, name: item.name.trim(), members };
  });
}

function parseCustomerBranches(value: unknown): CustomerBranchSummary[] {
  if (!Array.isArray(value)) throw invalidCustomerResponse();
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      !isNonEmptyString(item.name) ||
      (item.status !== 'open' && item.status !== 'closed')
    ) {
      throw invalidCustomerResponse();
    }
    return { id: item.id, name: item.name.trim(), status: item.status };
  });
}

function invalidCustomerResponse() {
  return new CustomerApiError(
    'پاسخ سرویس کارت یا اطلاعات وابسته معتبر نیست.',
    502,
    'INVALID_RESPONSE',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMaskedCardIdentifier(value: unknown): value is string {
  const prefix = '•••• •••• ';
  return (
    typeof value === 'string' && value.startsWith(prefix) && value.slice(prefix.length).length === 4
  );
}

function isCardStatus(value: unknown): value is CustomerCard['status'] {
  return (
    value === 'pending_sync' || value === 'active' || value === 'blocked' || value === 'unlinked'
  );
}

function isNullableDateTime(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
      Number.isFinite(Date.parse(value)))
  );
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json');

  const response = await fetch(`${customerApiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  const apiError = payload?.status === 'error' ? payload.error : undefined;
  if (!response.ok || payload?.status === 'error') {
    throw new CustomerApiError(
      apiError?.message || 'ارتباط با سرویس ممکن نشد.',
      response.status,
      apiError?.code,
    );
  }
  if (!payload || payload.status !== 'success') {
    throw new CustomerApiError('پاسخ سرویس معتبر نیست.', response.status);
  }
  return payload.data;
}

type ApiEnvelope<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; error?: { message?: string; code?: string } };
