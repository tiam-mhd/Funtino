import {
  getPermissionDefinition,
  type PermissionKey,
  type ScopeType,
} from './permission-catalog.js';
import { SYSTEM_ADMIN_MFA_SESSION_MAX_SECONDS } from './mfa-policy.js';

export type AccessScope =
  | { type: 'global' }
  | { type: 'organization'; organizationId: string }
  | { type: 'branch'; organizationId: string; branchId: string };

export type Membership = {
  id: string;
  userId: string;
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  scope: Exclude<AccessScope, { type: 'global' }> | { type: 'global' };
};

export type Role = {
  id: string;
  status: 'active' | 'disabled';
  scope: AccessScope;
  permissions: readonly string[];
};

export type PermissionOverride = {
  id: string;
  membershipId: string;
  permission: string;
  effect: 'allow' | 'deny';
  scope: AccessScope;
  resource?: { type: string; id: string };
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type AuthorizationContext = {
  actorUserId: string;
  membership: Membership;
  role: Role;
  overrides: readonly PermissionOverride[];
  policyVersion: number;
  mfaVerifiedAt?: Date | null;
};

export type AuthorizationRequest = {
  permission: string;
  scope: AccessScope;
  resource?: { type: string; id: string };
};

export type AuthorizationDecision = {
  allowed: boolean;
  permission: string;
  policyVersion: number;
  reason:
    | 'role_permission'
    | 'user_allow_override'
    | 'user_deny_override'
    | 'permission_unknown'
    | 'policy_version_invalid'
    | 'evaluation_time_invalid'
    | 'membership_inactive'
    | 'actor_mismatch'
    | 'role_inactive'
    | 'scope_invalid'
    | 'permission_not_granted'
    | 'step_up_required'
    | 'step_up_policy_unconfigured';
};

export type AuthorizationOptions = {
  now?: Date;
  /** Required to evaluate a permission marked stepUp; undefined intentionally fails closed. */
  mfaFreshnessSeconds?: number;
  /** Allows command-level MFA for a low-risk shared permission without gating its read route. */
  forceStepUp?: boolean;
};

function scopeType(scope: AccessScope): ScopeType {
  return scope.type;
}

function isAccessScope(value: unknown): value is AccessScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Record<string, unknown>;
  if (scope.type === 'global') return true;
  if (scope.type === 'organization') {
    return typeof scope.organizationId === 'string' && scope.organizationId.trim().length > 0;
  }
  return (
    scope.type === 'branch' &&
    typeof scope.organizationId === 'string' &&
    scope.organizationId.trim().length > 0 &&
    typeof scope.branchId === 'string' &&
    scope.branchId.trim().length > 0
  );
}

function scopeIdsMatch(left: AccessScope, right: AccessScope): boolean {
  if (left.type === 'global' || right.type === 'global') return left.type === right.type;
  if (left.organizationId !== right.organizationId) return false;
  return left.type !== 'branch' || (right.type === 'branch' && left.branchId === right.branchId);
}

function scopeContains(container: AccessScope, target: AccessScope): boolean {
  if (container.type === 'global') return true;
  if (target.type === 'global' || container.organizationId !== target.organizationId) return false;
  if (container.type === 'organization') return true;
  return target.type === 'branch' && container.branchId === target.branchId;
}

function scopeDepth(scope: AccessScope): number {
  return scope.type === 'global' ? 0 : scope.type === 'organization' ? 1 : 2;
}

function roleScopeContains(roleScope: AccessScope, target: AccessScope): boolean {
  if (roleScope.type === 'global') return true;
  if (roleScope.type === 'organization') {
    return target.type !== 'global' && target.organizationId === roleScope.organizationId;
  }
  return (
    target.type === 'branch' &&
    target.organizationId === roleScope.organizationId &&
    target.branchId === roleScope.branchId
  );
}

function membershipScopeContains(membershipScope: AccessScope, target: AccessScope): boolean {
  if (membershipScope.type === 'global') return true;
  if (target.type === 'global') return false;
  if (membershipScope.organizationId !== target.organizationId) return false;
  if (membershipScope.type === 'organization') return true;
  return target.type === 'branch' && membershipScope.branchId === target.branchId;
}

function roleAssignmentScopeIsValid(roleScope: AccessScope, membershipScope: AccessScope): boolean {
  if (roleScope.type === 'global') return membershipScope.type === 'global';
  if (membershipScope.type === 'global') return false;
  if (roleScope.organizationId !== membershipScope.organizationId) return false;
  if (roleScope.type === 'organization') return true;
  return membershipScope.type === 'branch' && roleScope.branchId === membershipScope.branchId;
}

function overrideMatches(
  override: PermissionOverride,
  context: AuthorizationContext,
  request: AuthorizationRequest,
  now: Date,
  inheritDenial = false,
): boolean {
  if (
    override.membershipId !== context.membership.id ||
    override.permission !== request.permission
  ) {
    return false;
  }
  if (
    !isAccessScope(override.scope) ||
    !(override.startsAt instanceof Date) ||
    !Number.isFinite(override.startsAt.getTime())
  ) {
    return false;
  }
  if (
    override.expiresAt &&
    (!(override.expiresAt instanceof Date) || !Number.isFinite(override.expiresAt.getTime()))
  ) {
    return false;
  }
  if (
    override.resource &&
    (typeof override.resource.type !== 'string' ||
      !override.resource.type.trim() ||
      typeof override.resource.id !== 'string' ||
      !override.resource.id.trim())
  ) {
    return false;
  }
  if (override.revokedAt || override.startsAt.getTime() > now.getTime()) return false;
  if (override.expiresAt && override.expiresAt.getTime() <= now.getTime()) return false;
  if (!membershipScopeContains(context.membership.scope, override.scope)) return false;
  const scopeMatches =
    inheritDenial && override.effect === 'deny'
      ? scopeContains(override.scope, request.scope)
      : scopeIdsMatch(override.scope, request.scope);
  if (!scopeMatches) {
    return false;
  }
  if (override.resource) {
    return (
      request.resource?.type === override.resource.type &&
      request.resource.id === override.resource.id
    );
  }
  return true;
}

function decision(
  allowed: boolean,
  request: AuthorizationRequest,
  context: AuthorizationContext,
  reason: AuthorizationDecision['reason'],
): AuthorizationDecision {
  return { allowed, permission: request.permission, policyVersion: context.policyVersion, reason };
}

export function evaluateAuthorization(
  context: AuthorizationContext,
  request: AuthorizationRequest,
  options: AuthorizationOptions = {},
): AuthorizationDecision {
  const permission = getPermissionDefinition(request.permission);
  if (!permission) return decision(false, request, context, 'permission_unknown');
  if (!Number.isSafeInteger(context.policyVersion) || context.policyVersion < 1) {
    return decision(false, request, context, 'policy_version_invalid');
  }
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return decision(false, request, context, 'evaluation_time_invalid');
  }
  if (!isAccessScope(request.scope) || !isAccessScope(context.membership.scope)) {
    return decision(false, request, context, 'scope_invalid');
  }
  if (context.actorUserId !== context.membership.userId) {
    return decision(false, request, context, 'actor_mismatch');
  }
  if (context.membership.status !== 'active') {
    return decision(false, request, context, 'membership_inactive');
  }
  if (!permission.scopes.includes(scopeType(request.scope))) {
    return decision(false, request, context, 'scope_invalid');
  }
  if (!membershipScopeContains(context.membership.scope, request.scope)) {
    return decision(false, request, context, 'scope_invalid');
  }

  const activeOverrides = context.overrides.filter((override) =>
    overrideMatches(override, context, request, now, true),
  );
  if (activeOverrides.some((override) => override.effect === 'deny')) {
    return decision(false, request, context, 'user_deny_override');
  }

  if (!isAccessScope(context.role.scope)) {
    return decision(false, request, context, 'scope_invalid');
  }
  if (context.role.status !== 'active') return decision(false, request, context, 'role_inactive');

  const roleGrantsPermission =
    context.role.permissions.includes(request.permission) &&
    roleAssignmentScopeIsValid(context.role.scope, context.membership.scope) &&
    roleScopeContains(context.role.scope, request.scope);
  const userAllowsPermission = activeOverrides.some((override) => override.effect === 'allow');
  if (!roleGrantsPermission && !userAllowsPermission) {
    return decision(false, request, context, 'permission_not_granted');
  }

  if (permission.stepUp || options.forceStepUp === true) {
    const maxFreshnessSeconds =
      context.membership.status === 'active' &&
      context.membership.scope.type === 'global' &&
      context.role.status === 'active' &&
      context.role.scope.type === 'global' &&
      context.role.permissions.includes('system.session_policy.manage')
        ? SYSTEM_ADMIN_MFA_SESSION_MAX_SECONDS
        : 900;
    if (
      !Number.isSafeInteger(options.mfaFreshnessSeconds) ||
      options.mfaFreshnessSeconds! < 1 ||
      options.mfaFreshnessSeconds! > maxFreshnessSeconds
    ) {
      return decision(false, request, context, 'step_up_policy_unconfigured');
    }
    const verifiedAt =
      context.mfaVerifiedAt instanceof Date ? context.mfaVerifiedAt.getTime() : undefined;
    if (
      verifiedAt === undefined ||
      !Number.isFinite(verifiedAt) ||
      verifiedAt > now.getTime() ||
      now.getTime() - verifiedAt > options.mfaFreshnessSeconds! * 1000
    ) {
      return decision(false, request, context, 'step_up_required');
    }
  }

  return decision(
    true,
    request,
    context,
    roleGrantsPermission ? 'role_permission' : 'user_allow_override',
  );
}

/**
 * Evaluates the union of a user's applicable memberships. A scoped deny clips grants at
 * the same or narrower scope; it cannot erase an independent grant from a broader scope.
 * An explicit deny on a global membership remains a user-wide veto for descendant scopes.
 */
export function evaluateAuthorizationAcrossMemberships(
  contexts: readonly AuthorizationContext[],
  request: AuthorizationRequest,
  policyVersion: number,
  options: AuthorizationOptions = {},
): AuthorizationDecision {
  const denied = (reason: AuthorizationDecision['reason']): AuthorizationDecision => ({
    allowed: false,
    permission: request.permission,
    policyVersion,
    reason,
  });
  if (!getPermissionDefinition(request.permission)) return denied('permission_unknown');
  if (!Number.isSafeInteger(policyVersion) || policyVersion < 1) {
    return denied('policy_version_invalid');
  }
  if (!isAccessScope(request.scope)) return denied('scope_invalid');

  const applicable = contexts.filter(
    (context) =>
      isAccessScope(context.membership.scope) &&
      membershipScopeContains(context.membership.scope, request.scope),
  );
  if (applicable.length === 0) return denied('membership_inactive');

  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    return denied('evaluation_time_invalid');
  const globalDeny = applicable.some(
    (context) =>
      context.actorUserId === context.membership.userId &&
      context.membership.status === 'active' &&
      context.policyVersion === policyVersion &&
      context.membership.scope.type === 'global' &&
      context.overrides.some(
        (override) =>
          override.effect === 'deny' &&
          override.scope.type === 'global' &&
          overrideMatches(override, context, request, now, true),
      ),
  );
  if (globalDeny) return denied('user_deny_override');

  const decisions = applicable.map((context) =>
    context.policyVersion === policyVersion
      ? evaluateAuthorization(context, request, options)
      : denied('policy_version_invalid'),
  );
  const denials = applicable.flatMap((context) =>
    context.actorUserId === context.membership.userId &&
    context.membership.status === 'active' &&
    context.policyVersion === policyVersion
      ? context.overrides
          .filter(
            (override) =>
              override.effect === 'deny' && overrideMatches(override, context, request, now, true),
          )
          .map((override) => ({ scope: override.scope, contextScope: context.membership.scope }))
      : [],
  );
  const grantIndex = decisions.findIndex((result, index) => {
    if (!result.allowed) return false;
    const grantScope = applicable[index]!.membership.scope;
    return !denials.some(
      (denial) =>
        scopeContains(denial.scope, request.scope) &&
        scopeDepth(denial.scope) <= scopeDepth(grantScope) &&
        scopeContains(denial.contextScope, request.scope),
    );
  });
  if (grantIndex >= 0) return { ...decisions[grantIndex]!, allowed: true, policyVersion };
  if (denials.length > 0) return denied('user_deny_override');

  return { ...decisions[0]!, policyVersion };
}

export function evaluateDelegation(
  context: AuthorizationContext,
  requestedPermissions: readonly string[],
  targetScope: AccessScope,
  options: AuthorizationOptions = {},
): AuthorizationDecision {
  const delegationRequest: AuthorizationRequest = {
    permission: 'access.permission.delegate',
    scope: targetScope,
  };
  const delegation = evaluateAuthorization(context, delegationRequest, options);
  if (!delegation.allowed) return delegation;

  for (const key of requestedPermissions) {
    const definition = getPermissionDefinition(key);
    const permissionDecision = evaluateAuthorization(
      context,
      { permission: key, scope: targetScope },
      options,
    );
    if (!definition?.delegable || !permissionDecision.allowed) {
      return decision(
        false,
        { permission: key, scope: targetScope },
        context,
        definition ? 'permission_not_granted' : 'permission_unknown',
      );
    }
  }

  return delegation;
}

export function evaluateDelegationAcrossMemberships(
  contexts: readonly AuthorizationContext[],
  requestedPermissions: readonly string[],
  targetScope: AccessScope,
  policyVersion: number,
  options: AuthorizationOptions = {},
): AuthorizationDecision {
  const delegation = evaluateAuthorizationAcrossMemberships(
    contexts,
    { permission: 'access.permission.delegate', scope: targetScope },
    policyVersion,
    options,
  );
  if (!delegation.allowed) return delegation;

  for (const key of requestedPermissions) {
    const definition = getPermissionDefinition(key);
    if (!definition?.delegable) {
      return {
        ...delegation,
        allowed: false,
        permission: key,
        reason: definition ? 'permission_not_granted' : 'permission_unknown',
      };
    }
    const result = evaluateAuthorizationAcrossMemberships(
      contexts,
      { permission: key, scope: targetScope },
      policyVersion,
      options,
    );
    if (!result.allowed) return result;
  }

  return delegation;
}

/**
 * Checks whether policy grants a permission, deliberately excluding step-up freshness.
 * This is for invariant checks (for example, ensuring an administrator remains), never for
 * authorizing a user request. User-request authorization must use evaluateAuthorization*.
 */
export function hasEffectivePermissionWithoutStepUp(
  contexts: readonly AuthorizationContext[],
  request: AuthorizationRequest,
  policyVersion: number,
  now = new Date(),
): boolean {
  if (
    !getPermissionDefinition(request.permission) ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion < 1 ||
    !isAccessScope(request.scope) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return false;
  }

  const applicable = contexts.filter(
    (context) =>
      context.actorUserId === context.membership.userId &&
      context.membership.status === 'active' &&
      context.policyVersion === policyVersion &&
      membershipScopeContains(context.membership.scope, request.scope),
  );
  const denials = applicable.flatMap((context) =>
    context.overrides
      .filter(
        (override) =>
          override.effect === 'deny' && overrideMatches(override, context, request, now, true),
      )
      .map((override) => ({ scope: override.scope, contextScope: context.membership.scope })),
  );
  const globalDeny = denials.some(
    (denial) => denial.contextScope.type === 'global' && denial.scope.type === 'global',
  );
  if (globalDeny) return false;

  const decisions = applicable.map((context) => {
    const overrides = context.overrides.filter((override) =>
      overrideMatches(override, context, request, now),
    );
    const roleGrant =
      context.role.status === 'active' &&
      context.role.permissions.includes(request.permission) &&
      roleAssignmentScopeIsValid(context.role.scope, context.membership.scope) &&
      roleScopeContains(context.role.scope, request.scope);
    const hasGrant = roleGrant || overrides.some((override) => override.effect === 'allow');
    const suppressed = denials.some(
      (denial) =>
        scopeContains(denial.scope, request.scope) &&
        scopeDepth(denial.scope) <= scopeDepth(context.membership.scope) &&
        scopeContains(denial.contextScope, request.scope),
    );
    return hasGrant && !suppressed;
  });
  return decisions.some(Boolean);
}

export function assertAdministratorRemains(remainingActiveAdministrators: number): void {
  if (!Number.isSafeInteger(remainingActiveAdministrators) || remainingActiveAdministrators < 1) {
    throw new Error('LAST_ACTIVE_ADMINISTRATOR_REQUIRED');
  }
}

export function isCatalogPermission(value: string): value is PermissionKey {
  return getPermissionDefinition(value) !== undefined;
}
