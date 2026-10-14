import { apiRequest, apiRequestPage } from './client';
import type { OperationsScope } from '../auth/operations-access';

export type OperationsAccessRole = {
  id: string;
  name: string;
  scope: OperationsScope;
  permissionKeys: string[];
  systemManaged: boolean;
  status: 'active' | 'disabled';
  version: number;
};

export type OperationsStaffMember = {
  membershipId: string;
  userId: string;
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  scope: OperationsScope;
  role: OperationsAccessRole;
  version: number;
  maskedPhone?: string | null;
  identity?: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

export type OperationsStaffInvitation = {
  id: string;
  membershipId: string;
  status: 'pending';
  scope: OperationsScope;
  role: OperationsAccessRole;
  maskedPhone: string;
  expiresAt: string;
  isExpired: boolean;
  roleChanged: boolean;
};

export type MyStaffInvitation = {
  id: string;
  scope: OperationsScope | { type: 'global' };
  organizationName: string | null;
  branchName: string | null;
  scopeStatus: 'active' | 'inactive' | 'unavailable' | 'system_only';
  role: OperationsAccessRole;
  maskedPhone: string;
  expiresAt: string;
  roleChanged: boolean;
};

export type OperationsPermission = {
  key: string;
  scopes: Array<'global' | 'organization' | 'branch'>;
  delegable: boolean;
  stepUp: boolean;
};

export type PermissionOverride = {
  kind: 'permission_override';
  id: string;
  membershipId: string;
  permissionKey: string;
  effect: 'allow' | 'deny';
  scope: OperationsScope;
  resource?: { type: string; id: string };
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  reason?: string | null;
  createdAt?: string;
};

export type OperationsPage<T> = {
  data: T[];
  nextCursor: string | null;
  policyVersion?: number;
};

export type OperationsMfaStatus = {
  enabled: boolean;
  enrollmentPending: boolean;
  recoveryCodesRemaining: number;
};

export type OperationsMfaEnrollment = {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
};

export type OperationsMfaRecoveryCodes = {
  recoveryCodes: string[];
  factorVersion: number;
  method: 'totp' | 'recovery';
  verifiedAt: string;
  validUntil: string;
};

export type OperationsMfaStepUp = {
  method: 'totp' | 'recovery';
  factorVersion: number;
  verifiedAt: string;
  validUntil: string;
};

export function freshIdempotencyKey(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function scopedPath(path: string, scope: OperationsScope, cursor?: string): string {
  const query = new URLSearchParams({ scopeType: scope.type, pageSize: '100' });
  query.set('organizationId', scope.organizationId);
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  if (cursor) query.set('cursor', cursor);
  return `${path}?${query.toString()}`;
}

export function listOperationsStaff(
  scope: OperationsScope,
  cursor?: string,
): Promise<OperationsPage<OperationsStaffMember>> {
  return apiRequest(scopedPath('/api/v1/operations/staff', scope, cursor));
}

export function listOperationsRoles(
  scope: OperationsScope,
  cursor?: string,
): Promise<{ data: OperationsAccessRole[]; nextCursor: string | null }> {
  return apiRequestPage(scopedPath('/api/v1/operations/roles', scope, cursor));
}

export function listScopedStaffInvitations(
  scope: OperationsScope,
  cursor?: string,
): Promise<OperationsPage<OperationsStaffInvitation>> {
  return apiRequest(scopedPath('/api/v1/operations/staff/invitations', scope, cursor));
}

export function listOperationsPermissions(): Promise<OperationsPermission[]> {
  return apiRequest('/api/v1/operations/permissions');
}

export function listMyStaffInvitations(): Promise<{ data: MyStaffInvitation[] }> {
  return apiRequest('/api/v1/operations/staff/invitations/pending');
}

export function acceptMyStaffInvitation(
  invitationId: string,
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest(
    `/api/v1/operations/staff/invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export function inviteOperationsStaff(
  input: {
    phoneE164: string;
    scope: OperationsScope;
    roleId: string;
    reason?: string;
  },
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest('/api/v1/operations/staff/invitations', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: input,
  });
}

export function revokeScopedStaffInvitation(
  invitationId: string,
  reason: string | undefined,
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest(
    `/api/v1/operations/staff/invitations/${encodeURIComponent(invitationId)}/revoke`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: reason ? { reason } : {},
    },
  );
}

export function changeOperationsStaffRole(
  member: OperationsStaffMember,
  roleId: string,
  reason: string,
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest(`/api/v1/operations/staff/${encodeURIComponent(member.membershipId)}`, {
    method: 'PATCH',
    headers: {
      'If-Match': `"${member.version}"`,
      'Idempotency-Key': idempotencyKey,
    },
    body: { roleId, reason },
  });
}

export function changeOperationsStaffStatus(
  membershipId: string,
  action: 'suspend' | 'reactivate',
  reason: string | undefined,
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest(`/api/v1/operations/staff/${encodeURIComponent(membershipId)}/${action}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: reason ? { reason } : {},
  });
}

export function listStaffPermissionOverrides(
  membershipId: string,
): Promise<{ data: PermissionOverride[]; policyVersion: number }> {
  return apiRequest(
    `/api/v1/operations/staff/${encodeURIComponent(membershipId)}/permission-overrides`,
  );
}

export function createStaffPermissionOverride(
  membershipId: string,
  input: {
    permission: string;
    effect: 'allow' | 'deny';
    scope: OperationsScope;
    resource?: { type: string; id: string };
    expiresAt?: string;
    reason: string;
  },
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest(
    `/api/v1/operations/staff/${encodeURIComponent(membershipId)}/permission-overrides`,
    { method: 'PUT', headers: { 'Idempotency-Key': idempotencyKey }, body: input },
  );
}

export function revokeStaffPermissionOverride(
  membershipId: string,
  overrideId: string,
  reason: string,
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest(
    `/api/v1/operations/staff/${encodeURIComponent(membershipId)}/permission-overrides/${encodeURIComponent(overrideId)}`,
    { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey }, body: { reason } },
  );
}

export function getOperationsMfaStatus(): Promise<OperationsMfaStatus> {
  return apiRequest('/api/v1/operations/mfa/status');
}

export function startOperationsMfaEnrollment(): Promise<OperationsMfaEnrollment> {
  return apiRequest('/api/v1/operations/mfa/enrollment/start', { method: 'POST' });
}

export function confirmOperationsMfaEnrollment(code: string): Promise<OperationsMfaRecoveryCodes> {
  return apiRequest('/api/v1/operations/mfa/enrollment/confirm', {
    method: 'POST',
    body: { code },
  });
}

export function verifyOperationsMfaStepUp(input: {
  method: 'totp' | 'recovery';
  code: string;
}): Promise<OperationsMfaStepUp> {
  return apiRequest('/api/v1/operations/mfa/step-up/verify', {
    method: 'POST',
    body: input,
  });
}
