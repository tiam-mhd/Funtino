import type {
  OperationsAccessRole,
  OperationsStaffMember,
} from '../../lib/api/operations-staff';
import type { OperationsScope, OperationsScopeOption } from '../../lib/auth/operations-access';

export function operationsStaffMemberName(member: OperationsStaffMember): string {
  return (
    member.identity?.displayName?.trim() ||
    [member.identity?.firstName, member.identity?.lastName].filter(Boolean).join(' ').trim() ||
    'عضو بدون نام نمایشی'
  );
}

export function operationsStaffScopeLabel(
  scope: OperationsScope,
  options: OperationsScopeOption[],
): string {
  if (scope.type === 'organization') {
    const option = options.find(
      (candidate) =>
        candidate.scope.type === 'organization' &&
        sameId(candidate.scope.organizationId, scope.organizationId),
    );
    return `مجموعه ${option?.organization.name.trim() || 'بدون نام نمایشی'}`;
  }

  const option = options.find(
    (candidate) =>
      candidate.scope.type === 'branch' &&
      sameId(candidate.scope.organizationId, scope.organizationId) &&
      sameId(candidate.scope.branchId, scope.branchId),
  );
  const branchName = option?.branch?.name.trim() || 'بدون نام نمایشی';
  const organizationName =
    option?.organization.name.trim() ||
    options.find(
      (candidate) =>
        candidate.scope.type === 'organization' &&
        sameId(candidate.scope.organizationId, scope.organizationId),
    )?.organization.name.trim() ||
    'بدون نام نمایشی';
  return `شعبه ${branchName} · ${organizationName}`;
}

export function operationsStaffStatusLabel(status: OperationsStaffMember['status']): string {
  switch (status) {
    case 'pending':
      return 'در انتظار پذیرش';
    case 'active':
      return 'فعال';
    case 'suspended':
      return 'معلق';
    case 'revoked':
      return 'لغوشده';
  }
}

export function operationsStaffStatusTone(
  status: OperationsStaffMember['status'],
): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'revoked') return 'danger';
  return 'neutral';
}

export function groupOperationsStaff(
  members: OperationsStaffMember[],
  activeScope: OperationsScope,
  options: OperationsScopeOption[],
): Array<{ key: string; heading: string | null; members: OperationsStaffMember[] }> {
  if (activeScope.type === 'branch') {
    return [{ key: 'active-branch', heading: null, members }];
  }

  const groups = new Map<string, { heading: string; members: OperationsStaffMember[] }>();
  for (const member of members) {
    const key =
      member.scope.type === 'organization'
        ? `organization:${member.scope.organizationId.toLowerCase()}`
        : `branch:${member.scope.organizationId.toLowerCase()}:${member.scope.branchId.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = { heading: operationsStaffScopeLabel(member.scope, options), members: [] };
      groups.set(key, group);
    }
    group.members.push(member);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

export function isStaffRoleAssignable(role: OperationsAccessRole, scope: OperationsScope): boolean {
  if (role.deletedAt || role.status !== 'active' || role.systemManaged) return false;
  if (scope.type === 'organization') {
    return (
      role.scope.type === 'organization' &&
      sameId(role.scope.organizationId, scope.organizationId)
    );
  }
  if (!sameId(role.scope.organizationId, scope.organizationId)) return false;
  return (
    role.scope.type === 'organization' ||
    (role.scope.type === 'branch' && sameId(role.scope.branchId, scope.branchId))
  );
}

export function isSameOperationsScope(a: OperationsScope, b: OperationsScope): boolean {
  return (
    a.type === b.type &&
    sameId(a.organizationId, b.organizationId) &&
    (a.type !== 'branch' || (b.type === 'branch' && sameId(a.branchId, b.branchId)))
  );
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
