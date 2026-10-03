import { apiRequest } from '../api/client';

export type OperationsUser = {
  id: string;
  phoneE164: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
};

export type OperationsScope =
  | { type: 'organization'; organizationId: string }
  | { type: 'branch'; organizationId: string; branchId: string };

export type OperationsScopeOption = {
  scope: OperationsScope;
  organization: { id: string; name: string };
  branch?: { id: string; name: string; city: string };
};

type OtpChallenge = {
  challengeId: string;
  expiresAt: string;
  deliveryStatus?: 'confirmed' | 'unknown';
};

export function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function normalizePhone(value: string): string {
  const normalized = normalizeDigits(value).replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(normalized)) return `+98${normalized.slice(1)}`;
  if (/^0098\d{10}$/.test(normalized)) return `+${normalized.slice(2)}`;
  return normalized;
}

export function requestOperationsOtp(phone: string): Promise<OtpChallenge> {
  return apiRequest('/api/v1/auth/otp/request', {
    method: 'POST',
    body: { phone },
  });
}

export async function verifyOperationsOtp(input: {
  challengeId: string;
  phone: string;
  code: string;
}): Promise<{ mfaRequired: boolean }> {
  return apiRequest('/api/v1/auth/otp/verify', { method: 'POST', body: input });
}

export function getOperationsUser(): Promise<OperationsUser> {
  return apiRequest('/api/v1/auth/me');
}

export function getOperationsScopes(): Promise<{
  items: OperationsScopeOption[];
  policyVersion: number;
}> {
  return apiRequest('/api/v1/operations/scopes');
}

export function selectOperationsScope(
  scope: OperationsScope,
): Promise<OperationsScopeOption & { policyVersion: number }> {
  return apiRequest('/api/v1/operations/scope-selection', {
    method: 'POST',
    body: { scope },
  });
}

export async function logoutOperations(): Promise<void> {
  await apiRequest('/api/v1/auth/logout', { method: 'POST' });
}

export function scopeKey(scope: OperationsScope): string {
  return scope.type === 'organization'
    ? `organization:${scope.organizationId.toLowerCase()}`
    : `branch:${scope.organizationId.toLowerCase()}:${scope.branchId.toLowerCase()}`;
}
