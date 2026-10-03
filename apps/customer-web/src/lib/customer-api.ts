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

export type AdminMfaStatus = {
  enabled: boolean;
  enrollmentPending: boolean;
  recoveryCodesRemaining: number;
};

export type AdminMfaEnrollment = {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
};

export type AdminMfaRecovery = {
  recoveryCodes: string[];
  validUntil: string;
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
}): Promise<{ user: CustomerUser; expiresAt: string; mfaRequired: boolean }> {
  return apiFetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getOperationsAdminMfaStatus(): Promise<AdminMfaStatus> {
  return apiFetch('/api/v1/operations/mfa/status');
}

export function startOperationsAdminMfaEnrollment(): Promise<AdminMfaEnrollment> {
  return apiFetch('/api/v1/operations/mfa/enrollment/start', { method: 'POST' });
}

export function confirmOperationsAdminMfaEnrollment(code: string): Promise<AdminMfaRecovery> {
  return apiFetch('/api/v1/operations/mfa/enrollment/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function verifyOperationsAdminMfaStepUp(input: {
  method: 'totp' | 'recovery';
  code: string;
}): Promise<{ validUntil: string }> {
  return apiFetch('/api/v1/operations/mfa/step-up/verify', {
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
