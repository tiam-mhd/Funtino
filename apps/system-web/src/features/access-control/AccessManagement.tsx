'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { DateTimePickerField } from '@funtino/design-system';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import { ManagementListPage } from '../../components/system-shell/ManagementListPage';
import { SystemConfirmDialog } from '../../components/system-shell/SystemConfirmDialog';
import {
  activeScopeOptions,
  loadAllScopeOptions,
  resolveSelectedScope,
  type Scope,
  type ScopeBranchOption,
  type ScopeOptionPage,
  type ScopeOrganizationOption,
} from './scope-options';
import styles from './AccessManagement.module.css';

type Role = {
  id: string;
  name: string;
  scope: Scope;
  permissionKeys: string[];
  systemManaged: boolean;
  status: 'active' | 'disabled';
  version: number;
};
type Permission = {
  key: string;
  scopes: Array<'global' | 'organization' | 'branch'>;
  delegable: boolean;
  stepUp: boolean;
};
type Template = { key: string; name: string; scopeType: Scope['type']; permissionKeys: string[] };
type Staff = {
  membershipId: string;
  userId: string;
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  scope: Scope;
  role: Role;
  version: number;
  maskedPhone?: string | null;
};
type Override = {
  kind: 'permission_override';
  id: string;
  membershipId: string;
  permissionKey: string;
  effect: 'allow' | 'deny';
  scope: Scope;
  expiresAt: string | null;
  revokedAt: string | null;
  reason?: string | null;
};
type AuditItem = {
  id: string;
  actorType: 'user' | 'system';
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  outcome: string;
  createdAt: string;
  policyVersion: number | null;
};
type Invitation = {
  id: string;
  scope: Scope;
  organizationName: string | null;
  branchName: string | null;
  scopeStatus: 'active' | 'inactive' | 'unavailable' | 'system_only';
  role: Role;
  maskedPhone: string;
  expiresAt: string;
  roleChanged: boolean;
};
type ScopedInvitation = {
  id: string;
  membershipId: string;
  status: 'pending';
  scope: Scope;
  role: Role;
  maskedPhone: string;
  expiresAt: string;
  isExpired: boolean;
  roleChanged: boolean;
};
type StaffPage = { data: Staff[]; nextCursor: string | null; policyVersion: number };
type AuditPage = { data: AuditItem[]; nextCursor: string | null; policyVersion: number };
type TemplatePage = { data: Template[]; catalogVersion: number; policyVersion: number };
type OverridePage = { data: Override[]; policyVersion: number };
type ScopedInvitationPage = {
  data: ScopedInvitation[];
  nextCursor: string | null;
  policyVersion: number;
};
type PendingConfirmation =
  | { kind: 'membership'; member: Staff }
  | { kind: 'override'; member: Staff; override: Override };

const iranPhonePattern = /^\+?[1-9][0-9]{7,14}$/;

function optionalReason(reason: string): { reason?: string } {
  const value = reason.trim();
  return value ? { reason: value } : {};
}

function scopeQuery(scope: Scope): string {
  const query = new URLSearchParams({ scopeType: scope.type });
  if (scope.type !== 'global') query.set('organizationId', scope.organizationId);
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  return query.toString();
}

function scopeLabel(scope: Scope, organizationName?: string, branchName?: string): string {
  if (scope.type === 'global') return 'سراسری';
  if (scope.type === 'organization') return `مجموعه ${organizationName ?? scope.organizationId}`;
  return `شعبه ${branchName ?? scope.branchId} · مجموعه ${organizationName ?? scope.organizationId}`;
}

function invitationScopeLabel(invitation: Invitation): string {
  if (invitation.scope.type === 'global') return 'دسترسی سراسری سامانه';
  if (invitation.scope.type === 'organization') {
    return `مجموعه: ${invitation.organizationName ?? 'نامشخص'}`;
  }
  return `شعبه: ${invitation.branchName ?? 'نامشخص'} · مجموعه: ${invitation.organizationName ?? 'نامشخص'}`;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'ارتباط با سرویس مدیریت دسترسی برقرار نشد.';
}

function freshIdempotencyKey(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

type AccessView = 'received' | 'issued' | 'roles' | 'staff' | 'audit';

export function AccessManagement({ view = 'staff' }: { view?: AccessView }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = pathname.split('/')[1] || 'fa';
  const accessBasePath = `/${locale}/access`;
  const receivedInvitationRouteMatch = pathname.match(/\/access\/invitations\/received\/([^/]+)$/);
  const issuedInvitationRouteMatch = pathname.match(/\/access\/invitations\/issued\/([^/]+)$/);
  const auditRouteMatch = pathname.match(/\/access\/audit\/([^/]+)$/);
  const roleRouteMatch = pathname.match(/\/access\/roles\/([^/]+)(?:\/(edit))?$/);
  const staffRouteMatch = pathname.match(/\/access\/staff\/([^/]+)(?:\/(edit))?$/);
  const accessRouteMode = receivedInvitationRouteMatch
    ? 'received-details'
    : issuedInvitationRouteMatch
      ? 'issued-details'
      : auditRouteMatch
        ? 'audit-details'
        : pathname.endsWith('/access/staff/invite')
          ? 'staff-invite'
          : pathname.endsWith('/access/roles/new')
            ? 'role-create'
            : roleRouteMatch
              ? roleRouteMatch[2]
                ? 'role-edit'
                : 'role-details'
              : staffRouteMatch && staffRouteMatch[1] !== 'invite'
                ? staffRouteMatch[2]
                  ? 'staff-edit'
                  : 'staff-details'
                : 'list';
  const routeResourceId =
    receivedInvitationRouteMatch || issuedInvitationRouteMatch || auditRouteMatch
      ? decodeURIComponent(
          receivedInvitationRouteMatch?.[1] ??
            issuedInvitationRouteMatch?.[1] ??
            auditRouteMatch?.[1] ??
            '',
        )
      : accessRouteMode === 'role-edit' || accessRouteMode === 'role-details'
        ? decodeURIComponent(roleRouteMatch?.[1] ?? '')
        : accessRouteMode === 'staff-edit' || accessRouteMode === 'staff-details'
          ? decodeURIComponent(staffRouteMatch?.[1] ?? '')
          : '';
  const [scopeType, setScopeType] = useState<Scope['type']>(() => {
    const value = searchParams.get('scopeType');
    return value === 'organization' || value === 'branch' ? value : 'global';
  });
  const [organizationId, setOrganizationId] = useState(
    () => searchParams.get('organizationId') ?? '',
  );
  const [branchId, setBranchId] = useState(() => searchParams.get('branchId') ?? '');
  const [roles, setRoles] = useState<Role[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffNextCursor, setStaffNextCursor] = useState<string | null>(null);
  const [staffCursorHistory, setStaffCursorHistory] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditCursorHistory, setAuditCursorHistory] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [scopedInvitations, setScopedInvitations] = useState<ScopedInvitation[]>([]);
  const [invitationNextCursor, setInvitationNextCursor] = useState<string | null>(null);
  const [invitationCursorHistory, setInvitationCursorHistory] = useState<Array<string | undefined>>(
    [undefined],
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showStepUpLink, setShowStepUpLink] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [roleName, setRoleName] = useState('');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteReason, setInviteReason] = useState('');
  const [reason, setReason] = useState('');
  const [roleEditReasons, setRoleEditReasons] = useState<Record<string, string>>({});
  const [roleEdits, setRoleEdits] = useState<
    Record<string, { name: string; status: Role['status']; permissionKeys: string[] }>
  >({});
  const [staffRoleEdits, setStaffRoleEdits] = useState<Record<string, string>>({});
  const [openOverrideMembership, setOpenOverrideMembership] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override[]>>({});
  const [overridePermission, setOverridePermission] = useState('');
  const [overrideEffect, setOverrideEffect] = useState<'allow' | 'deny'>('deny');
  const [overrideExpiry, setOverrideExpiry] = useState('');
  const [organizations, setOrganizations] = useState<ScopeOrganizationOption[]>([]);
  const [branches, setBranches] = useState<ScopeBranchOption[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState('');
  const [branchesError, setBranchesError] = useState('');
  const [branchListRefresh, setBranchListRefresh] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [localPageNumber, setLocalPageNumber] = useState(1);

  const loadOrganizations = useCallback(async () => {
    setOrganizationsLoading(true);
    setOrganizationsError('');
    try {
      const items = await loadAllScopeOptions<ScopeOrganizationOption>((cursor, pageSize) => {
        const query = new URLSearchParams({ pageSize: String(pageSize) });
        if (cursor) query.set('cursor', cursor);
        return apiRequest<ScopeOptionPage<ScopeOrganizationOption>>(
          `/api/v1/system/organizations?${query.toString()}`,
        );
      });
      const selectable = activeScopeOptions(items);
      setOrganizations(selectable);
      setOrganizationId((current) =>
        selectable.some((organization) => organization.id === current) ? current : '',
      );
    } catch (caught) {
      setOrganizationsError(messageFor(caught));
    } finally {
      setOrganizationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    if (scopeType !== 'branch' || !organizationId) {
      setBranches([]);
      setBranchId('');
      setBranchesError('');
      setBranchesLoading(false);
      return;
    }

    let cancelled = false;
    setBranchesError('');
    setBranchesLoading(true);

    void loadAllScopeOptions<ScopeBranchOption>((cursor, pageSize) => {
      const query = new URLSearchParams({ pageSize: String(pageSize) });
      if (cursor) query.set('cursor', cursor);
      return apiRequest<ScopeOptionPage<ScopeBranchOption>>(
        `/api/v1/system/organizations/${encodeURIComponent(organizationId)}/branches?${query.toString()}`,
      );
    })
      .then((items) => {
        if (!cancelled) setBranches(activeScopeOptions(items));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setBranchesError(messageFor(caught));
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branchListRefresh, organizationId, scopeType]);

  const scope = useMemo<Scope | null>(() => {
    return resolveSelectedScope(scopeType, organizationId, branchId, organizations, branches);
  }, [scopeType, organizationId, branchId, organizations, branches]);

  function accessPathFor(targetView: AccessView = view) {
    const segments: Record<AccessView, string> = {
      received: 'invitations/received',
      issued: 'invitations/issued',
      roles: 'roles',
      staff: 'staff',
      audit: 'audit',
    };
    return `${accessBasePath}/${segments[targetView]}${scope ? `?${scopeQuery(scope)}` : ''}`;
  }

  function startRoleEdit(role: Role, navigate = true) {
    setRoleEdits((current) => ({
      ...current,
      [role.id]: {
        name: role.name,
        status: role.status,
        permissionKeys: [...role.permissionKeys],
      },
    }));
    if (navigate) {
      router.push(
        `${accessBasePath}/roles/${encodeURIComponent(role.id)}/edit${scope ? `?${scopeQuery(scope)}` : ''}`,
      );
    }
  }

  const labelScope = useCallback(
    (target: Scope) => {
      if (target.type === 'global') return scopeLabel(target);
      const organizationName = organizations.find(
        (organization) => organization.id === target.organizationId,
      )?.name;
      const branchName =
        target.type === 'branch'
          ? branches.find((branch) => branch.id === target.branchId)?.name
          : undefined;
      return scopeLabel(target, organizationName, branchName);
    },
    [branches, organizations],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    setAuditError('');
    setNotice('');
    setRoles([]);
    setStaff([]);
    setScopedInvitations([]);
    setStaffNextCursor(null);
    setAuditNextCursor(null);
    setInvitationNextCursor(null);
    setStaffCursorHistory([undefined]);
    setAuditCursorHistory([undefined]);
    setInvitationCursorHistory([undefined]);
    setLocalPageNumber(1);
    setAudit([]);
    setRoleEdits({});
    setRoleEditReasons({});
    setStaffRoleEdits({});
    setOverrides({});
    if (!scope) {
      setError(
        scopeType === 'branch'
          ? 'یک مجموعه و شعبه‌ی فعال را از فهرست انتخاب کنید.'
          : 'یک مجموعه‌ی فعال را از فهرست انتخاب کنید.',
      );
      setLoading(false);
      return;
    }
    const pendingPromise = apiRequest<{ data: Invitation[] }>(
      '/api/v1/operations/staff/invitations/pending',
    );
    const permissionPromise = apiRequest<Permission[]>('/api/v1/operations/permissions');
    const query = scopeQuery(scope);
    const results = await Promise.allSettled([
      apiRequest<Role[]>(`/api/v1/operations/roles?${query}`),
      apiRequest<StaffPage>(`/api/v1/operations/staff?${query}&pageSize=25`),
      apiRequest<ScopedInvitationPage>(`/api/v1/operations/staff/invitations?${query}&pageSize=25`),
      apiRequest<TemplatePage>(`/api/v1/operations/roles/templates?${query}`),
      apiRequest<AuditPage>(`/api/v1/operations/audit?${query}&pageSize=30`),
      pendingPromise,
      permissionPromise,
    ]);
    const [
      roleResult,
      staffResult,
      scopedInvitationsResult,
      templateResult,
      auditResult,
      invitationsResult,
      catalogResult,
    ] = results;
    if (roleResult.status === 'fulfilled') setRoles(roleResult.value);
    if (staffResult.status === 'fulfilled') {
      setStaff(staffResult.value.data);
      setStaffNextCursor(staffResult.value.nextCursor);
    }
    if (scopedInvitationsResult.status === 'fulfilled') {
      setScopedInvitations(scopedInvitationsResult.value.data);
      setInvitationNextCursor(scopedInvitationsResult.value.nextCursor);
    }
    if (templateResult.status === 'fulfilled') setTemplates(templateResult.value.data);
    if (auditResult.status === 'fulfilled') {
      setAudit(auditResult.value.data);
      setAuditNextCursor(auditResult.value.nextCursor);
      setAuditError('');
    } else {
      setAuditError(
        auditResult.reason instanceof ApiRequestError && auditResult.reason.status === 403
          ? 'مجوز audit.read یا محدوده‌ی لازم برای مشاهده‌ی ممیزی در دسترس نیست.'
          : messageFor(auditResult.reason),
      );
    }
    if (invitationsResult.status === 'fulfilled')
      setPendingInvitations(invitationsResult.value.data);
    if (catalogResult.status === 'fulfilled') setPermissions(catalogResult.value);
    const rejected = results.find((result, index) => index !== 4 && result.status === 'rejected');
    if (rejected?.status === 'rejected') setError(messageFor(rejected.reason));
    setLoading(false);
  }, [scope, scopeType]);

  async function changeCursorPage(
    kind: 'staff' | 'issued' | 'audit',
    direction: 'previous' | 'next',
  ) {
    if (!scope || loading) return;
    const history =
      kind === 'staff'
        ? staffCursorHistory
        : kind === 'issued'
          ? invitationCursorHistory
          : auditCursorHistory;
    const nextCursor =
      kind === 'staff'
        ? staffNextCursor
        : kind === 'issued'
          ? invitationNextCursor
          : auditNextCursor;
    if (direction === 'previous' && history.length < 2) return;
    if (direction === 'next' && !nextCursor) return;
    const cursor = direction === 'next' ? nextCursor! : history[history.length - 2];
    const params = new URLSearchParams(scopeQuery(scope));
    params.set('pageSize', kind === 'audit' ? '30' : '25');
    if (cursor) params.set('cursor', cursor);
    setLoading(true);
    setError('');
    if (kind === 'audit') setAuditError('');
    try {
      if (kind === 'staff') {
        const page = await apiRequest<StaffPage>(`/api/v1/operations/staff?${params.toString()}`);
        setStaff(page.data);
        setStaffNextCursor(page.nextCursor);
        setStaffCursorHistory((current) =>
          direction === 'next' ? [...current, cursor] : current.slice(0, -1),
        );
      } else if (kind === 'issued') {
        const page = await apiRequest<ScopedInvitationPage>(
          `/api/v1/operations/staff/invitations?${params.toString()}`,
        );
        setScopedInvitations(page.data);
        setInvitationNextCursor(page.nextCursor);
        setInvitationCursorHistory((current) =>
          direction === 'next' ? [...current, cursor] : current.slice(0, -1),
        );
      } else {
        const page = await apiRequest<AuditPage>(`/api/v1/operations/audit?${params.toString()}`);
        setAudit(page.data);
        setAuditNextCursor(page.nextCursor);
        setAuditCursorHistory((current) =>
          direction === 'next' ? [...current, cursor] : current.slice(0, -1),
        );
      }
    } catch (caught) {
      if (kind === 'audit') {
        setAuditError(
          caught instanceof ApiRequestError && caught.status === 403
            ? 'مجوز audit.read یا محدوده‌ی لازم برای مشاهده‌ی ممیزی در دسترس نیست.'
            : messageFor(caught),
        );
      } else {
        setError(messageFor(caught));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLocalPageNumber(1);
  }, [view, accessRouteMode]);

  useEffect(() => {
    if (!scope) {
      setRoles([]);
      setStaff([]);
      setScopedInvitations([]);
      setAudit([]);
      setRoleEdits({});
      setRoleEditReasons({});
      setStaffRoleEdits({});
      setOverrides({});
      setAuditError('');
      return;
    }
    void loadData();
  }, [loadData, scope]);

  useEffect(() => {
    const template = templates.find((item) => item.key === selectedTemplate);
    if (!template) return;
    setRoleName(template.name);
    setRolePermissions([...template.permissionKeys]);
  }, [selectedTemplate, templates]);

  useEffect(() => {
    if (accessRouteMode !== 'role-edit') return;
    const role = roles.find((item) => item.id === routeResourceId);
    if (!role || role.systemManaged || roleEdits[role.id]) return;
    setRoleEdits((current) => ({
      ...current,
      [role.id]: {
        name: role.name,
        status: role.status,
        permissionKeys: [...role.permissionKeys],
      },
    }));
  }, [accessRouteMode, roleEdits, roles, routeResourceId]);

  async function perform(
    label: string,
    work: () => Promise<unknown>,
    mayRequireStepUp = false,
  ): Promise<boolean> {
    setError('');
    setNotice('');
    setShowStepUpLink(false);
    try {
      await work();
      await loadData();
      setNotice(label);
      return true;
    } catch (caught) {
      setError(messageFor(caught));
      setShowStepUpLink(
        mayRequireStepUp && caught instanceof ApiRequestError && caught.status === 403,
      );
      return false;
    }
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetScope = scope;
    if (!targetScope) {
      setError('ابتدا یک محدوده‌ی فعال را از فهرست انتخاب کنید.');
      return;
    }
    if (roleReason.trim().length < 8) {
      setError('برای ساخت نقش و اعطای مجوز، دلیل حداقل ۸ نویسه‌ای الزامی است.');
      return;
    }
    const created = await perform(
      'نقش با موفقیت ثبت شد.',
      async () => {
        await apiRequest('/api/v1/operations/roles', {
          method: 'POST',
          headers: { 'Idempotency-Key': freshIdempotencyKey() },
          body: {
            name: roleName,
            scope: targetScope,
            permissionKeys: rolePermissions,
            reason: roleReason.trim(),
          },
        });
        setRoleName('');
        setRolePermissions([]);
        setRoleReason('');
        setSelectedTemplate('');
      },
      true,
    );
    if (created) router.push(accessPathFor('roles'));
  }

  async function saveRole(role: Role) {
    const edit = roleEdits[role.id];
    if (!edit) {
      setError('ابتدا تغییرات نقش را مشخص کنید.');
      return;
    }
    const changedPermissionKeys =
      [...edit.permissionKeys].sort().join('\u0000') !==
      [...role.permissionKeys].sort().join('\u0000');
    const changedStatus = edit.status !== role.status;
    const changes = {
      ...(edit.name !== role.name ? { name: edit.name } : {}),
      ...(changedStatus ? { status: edit.status } : {}),
      ...(changedPermissionKeys ? { permissionKeys: edit.permissionKeys } : {}),
    };
    const editReason = roleEditReasons[role.id] ?? '';
    if (Object.keys(changes).length === 0) {
      setError('تغییری برای ذخیره وجود ندارد.');
      return;
    }
    if ((changedStatus || changedPermissionKeys) && editReason.trim().length < 8) {
      setError('برای تغییر دسترسی‌های نقش، دلیل حداقل ۸ نویسه‌ای الزامی است.');
      return;
    }
    const saved = await perform(
      'تغییرات نقش ذخیره شد.',
      async () => {
        await apiRequest(`/api/v1/operations/roles/${role.id}`, {
          method: 'PATCH',
          headers: { 'Idempotency-Key': freshIdempotencyKey(), 'If-Match': `"${role.version}"` },
          body: { ...changes, ...optionalReason(editReason) },
        });
        setRoleEdits((current) => {
          const next = { ...current };
          delete next[role.id];
          return next;
        });
        setRoleEditReasons((current) => {
          const next = { ...current };
          delete next[role.id];
          return next;
        });
      },
      true,
    );
    if (saved) router.push(accessPathFor('roles'));
  }

  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetScope = scope;
    if (!targetScope) {
      setError('ابتدا یک محدوده‌ی فعال را از فهرست انتخاب کنید.');
      return;
    }
    const normalizedPhone = invitePhone
      .replace(/[\s()-]/g, '')
      .replace(/^09/, '+989')
      .replace(/^0098/, '+98');
    if (!iranPhonePattern.test(normalizedPhone) || !inviteRoleId) {
      setError('شماره‌ی موبایل یا نقش انتخابی معتبر نیست.');
      return;
    }
    const invited = await perform(
      'دعوت ثبت شد؛ فعال‌سازی فقط پس از تأیید شماره و پذیرش صریح انجام می‌شود.',
      async () => {
        await apiRequest('/api/v1/operations/staff/invitations', {
          method: 'POST',
          headers: { 'Idempotency-Key': freshIdempotencyKey() },
          body: {
            phoneE164: normalizedPhone.startsWith('+') ? normalizedPhone : `+${normalizedPhone}`,
            scope: targetScope,
            roleId: inviteRoleId,
            ...optionalReason(inviteReason),
          },
        });
        setInvitePhone('');
        setInviteRoleId('');
        setInviteReason('');
      },
    );
    if (invited) router.push(accessPathFor('staff'));
  }

  async function changeStaffStatus(member: Staff, action: 'suspend' | 'reactivate' | 'revoke') {
    if (action === 'revoke') {
      if (reason.trim().length < 8) {
        setError('برای لغو عضویت فعال، دلیل حداقل ۸ نویسه‌ای الزامی است.');
        return;
      }
      setPendingConfirmation({ kind: 'membership', member });
      return;
    }
    const labels = {
      suspend: 'عضویت تعلیق شد.',
      reactivate: 'عضویت دوباره فعال شد.',
    };
    await perform(
      labels[action],
      async () => {
        await apiRequest(`/api/v1/operations/staff/${member.membershipId}/${action}`, {
          method: 'POST',
          headers: { 'Idempotency-Key': freshIdempotencyKey() },
          body: optionalReason(reason),
        });
        setReason('');
      },
      false,
    );
  }

  async function changeStaffRole(member: Staff) {
    const roleId = staffRoleEdits[member.membershipId];
    if (!roleId) {
      setError('نقش جدید را مشخص کنید.');
      return;
    }
    if (reason.trim().length < 8) {
      setError('برای تغییر نقش عضویت فعال، دلیل حداقل ۸ نویسه‌ای الزامی است.');
      return;
    }
    await perform(
      'نقش کارمند تغییر کرد.',
      async () => {
        await apiRequest(`/api/v1/operations/staff/${member.membershipId}`, {
          method: 'PATCH',
          headers: { 'Idempotency-Key': freshIdempotencyKey(), 'If-Match': `"${member.version}"` },
          body: { roleId, ...optionalReason(reason) },
        });
        setStaffRoleEdits((current) => {
          const next = { ...current };
          delete next[member.membershipId];
          return next;
        });
        setReason('');
      },
      true,
    );
  }

  async function openOverrides(member: Staff) {
    setOpenOverrideMembership(member.membershipId);
    try {
      const result = await apiRequest<OverridePage>(
        `/api/v1/operations/staff/${member.membershipId}/permission-overrides`,
      );
      setOverrides((current) => ({ ...current, [member.membershipId]: result.data }));
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function createOverride(member: Staff) {
    if (!scope || !overridePermission) {
      setError('مجوز و محدوده‌ی override را تکمیل کنید.');
      return;
    }
    if (reason.trim().length < 8) {
      setError('برای ایجاد override دسترسی، دلیل حداقل ۸ نویسه‌ای الزامی است.');
      return;
    }
    await perform(
      'override دسترسی ثبت شد.',
      async () => {
        await apiRequest(`/api/v1/operations/staff/${member.membershipId}/permission-overrides`, {
          method: 'PUT',
          headers: { 'Idempotency-Key': freshIdempotencyKey() },
          body: {
            permission: overridePermission,
            effect: overrideEffect,
            scope,
            ...(overrideExpiry ? { expiresAt: new Date(overrideExpiry).toISOString() } : {}),
            ...optionalReason(reason),
          },
        });
        setReason('');
        setOverridePermission('');
        setOverrideExpiry('');
        const result = await apiRequest<OverridePage>(
          `/api/v1/operations/staff/${member.membershipId}/permission-overrides`,
        );
        setOverrides((current) => ({ ...current, [member.membershipId]: result.data }));
      },
      true,
    );
  }

  async function revokeOverride(member: Staff, override: Override) {
    if (reason.trim().length < 8) {
      setError('برای لغو override، دلیل حداقل ۸ نویسه‌ای الزامی است.');
      return;
    }
    setPendingConfirmation({ kind: 'override', member, override });
  }

  async function confirmPendingAction() {
    const pending = pendingConfirmation;
    if (!pending) return;
    setPendingConfirmation(null);
    if (pending.kind === 'membership') {
      await perform(
        'عضویت لغو شد.',
        async () => {
          await apiRequest(`/api/v1/operations/staff/${pending.member.membershipId}/revoke`, {
            method: 'POST',
            headers: { 'Idempotency-Key': freshIdempotencyKey() },
            body: optionalReason(reason),
          });
          setReason('');
        },
        true,
      );
      return;
    }

    await perform(
      'override لغو شد.',
      async () => {
        await apiRequest(
          `/api/v1/operations/staff/${pending.member.membershipId}/permission-overrides/${pending.override.id}`,
          {
            method: 'DELETE',
            headers: { 'Idempotency-Key': freshIdempotencyKey() },
            body: { reason },
          },
        );
        setReason('');
        const result = await apiRequest<OverridePage>(
          `/api/v1/operations/staff/${pending.member.membershipId}/permission-overrides`,
        );
        setOverrides((current) => ({
          ...current,
          [pending.member.membershipId]: result.data,
        }));
      },
      true,
    );
  }

  async function acceptInvitation(invitation: Invitation) {
    await perform('دعوت پذیرفته شد و عضویت فعال شد.', async () => {
      await apiRequest(`/api/v1/operations/staff/invitations/${invitation.id}/accept`, {
        method: 'POST',
        headers: { 'Idempotency-Key': freshIdempotencyKey() },
        body: {},
      });
    });
  }

  async function revokeIssuedInvitation(invitation: ScopedInvitation) {
    await perform('دعوت صادرشده لغو شد.', async () => {
      await apiRequest(`/api/v1/operations/staff/invitations/${invitation.id}/revoke`, {
        method: 'POST',
        headers: { 'Idempotency-Key': freshIdempotencyKey() },
        body: optionalReason(reason),
      });
      setReason('');
    });
  }

  const applicablePermissions = permissions.filter(
    (permission) => permission.delegable && permission.scopes.includes(scope?.type ?? 'global'),
  );
  const visibleRoles = roles.slice((localPageNumber - 1) * 25, localPageNumber * 25);
  const staffRouteItems =
    accessRouteMode === 'staff-details' || accessRouteMode === 'staff-edit'
      ? staff.filter((member) => member.membershipId === routeResourceId)
      : staff;
  const roleListItems =
    accessRouteMode === 'role-edit' || accessRouteMode === 'role-details'
      ? roles.filter((role) => role.id === routeResourceId)
      : visibleRoles;
  const visiblePendingInvitations = pendingInvitations.slice(
    (localPageNumber - 1) * 25,
    localPageNumber * 25,
  );
  const receivedInvitationItems =
    accessRouteMode === 'received-details'
      ? pendingInvitations.filter((invitation) => invitation.id === routeResourceId)
      : visiblePendingInvitations;
  const issuedInvitationItems =
    accessRouteMode === 'issued-details'
      ? scopedInvitations.filter((invitation) => invitation.id === routeResourceId)
      : scopedInvitations;
  const auditListItems =
    accessRouteMode === 'audit-details'
      ? audit.filter((item) => item.id === routeResourceId)
      : audit;
  const listPagination =
    view === 'staff' && accessRouteMode === 'list'
      ? {
          page: staffCursorHistory.length,
          itemCount: staff.length,
          canGoPrevious: staffCursorHistory.length > 1,
          canGoNext: Boolean(staffNextCursor),
          busy: loading,
          onPrevious: () => void changeCursorPage('staff', 'previous'),
          onNext: () => void changeCursorPage('staff', 'next'),
        }
      : view === 'issued' && accessRouteMode === 'list'
        ? {
            page: invitationCursorHistory.length,
            itemCount: scopedInvitations.length,
            canGoPrevious: invitationCursorHistory.length > 1,
            canGoNext: Boolean(invitationNextCursor),
            busy: loading,
            onPrevious: () => void changeCursorPage('issued', 'previous'),
            onNext: () => void changeCursorPage('issued', 'next'),
          }
        : view === 'audit' && accessRouteMode === 'list'
          ? {
              page: auditCursorHistory.length,
              itemCount: audit.length,
              canGoPrevious: auditCursorHistory.length > 1,
              canGoNext: Boolean(auditNextCursor),
              busy: loading,
              onPrevious: () => void changeCursorPage('audit', 'previous'),
              onNext: () => void changeCursorPage('audit', 'next'),
            }
          : view === 'roles' && accessRouteMode === 'list'
            ? {
                page: localPageNumber,
                itemCount: visibleRoles.length,
                canGoPrevious: localPageNumber > 1,
                canGoNext: localPageNumber * 25 < roles.length,
                busy: loading,
                onPrevious: () => setLocalPageNumber((current) => Math.max(1, current - 1)),
                onNext: () => setLocalPageNumber((current) => current + 1),
              }
            : view === 'received' && accessRouteMode === 'list'
              ? {
                  page: localPageNumber,
                  itemCount: visiblePendingInvitations.length,
                  canGoPrevious: localPageNumber > 1,
                  canGoNext: localPageNumber * 25 < pendingInvitations.length,
                  busy: loading,
                  onPrevious: () => setLocalPageNumber((current) => Math.max(1, current - 1)),
                  onNext: () => setLocalPageNumber((current) => current + 1),
                }
              : undefined;

  return (
    <main className={styles.page}>
      <ManagementListPage
        eyebrow="کنترل مرکزی · امنیت و دسترسی"
        title={
          accessRouteMode === 'staff-invite'
            ? 'دعوت کارمند'
            : accessRouteMode === 'role-create'
              ? 'ایجاد نقش سفارشی'
              : accessRouteMode === 'role-edit'
                ? 'ویرایش نقش'
                : accessRouteMode === 'role-details'
                  ? 'جزئیات نقش'
                  : accessRouteMode === 'staff-edit'
                    ? 'تغییر نقش کارمند'
                    : accessRouteMode === 'staff-details'
                      ? 'جزئیات عضویت'
                      : accessRouteMode === 'received-details'
                        ? 'جزئیات دعوت دریافتی'
                        : accessRouteMode === 'issued-details'
                          ? 'جزئیات دعوت صادرشده'
                          : accessRouteMode === 'audit-details'
                            ? 'جزئیات رخداد ممیزی'
                            : view === 'received'
                              ? 'دعوت‌های دریافتی'
                              : view === 'issued'
                                ? 'دعوت‌های صادرشده'
                                : view === 'roles'
                                  ? 'نقش‌ها و مجوزها'
                                  : view === 'audit'
                                    ? 'ممیزی دسترسی'
                                    : 'کارکنان'
        }
        description={
          accessRouteMode === 'staff-invite'
            ? 'برای محدوده‌ی انتخاب‌شده دعوت بفرستید؛ فعال‌سازی پس از تأیید شماره و پذیرش انجام می‌شود.'
            : accessRouteMode === 'role-create'
              ? 'نقش تازه با مجوزهای مجاز این محدوده ثبت می‌شود.'
              : accessRouteMode === 'role-edit'
                ? 'تغییر نام، وضعیت یا مجوزها با کنترل نسخه و audit ذخیره می‌شود.'
                : accessRouteMode === 'role-details'
                  ? 'مشخصات و مجوزهای نقش در محدوده‌ی جاری.'
                  : accessRouteMode === 'staff-edit'
                    ? 'نقش عضویت فقط در محدوده‌ی مجاز سرور تغییر می‌کند.'
                    : accessRouteMode === 'staff-details'
                      ? 'اطلاعات حداقلی عضویت در محدوده‌ی جاری.'
                      : accessRouteMode === 'received-details'
                        ? 'وضعیت و دامنه‌ی دعوت دریافتی برای حساب جاری.'
                        : accessRouteMode === 'issued-details'
                          ? 'جزئیات دعوت صادرشده در محدوده‌ی مجاز فعلی.'
                          : accessRouteMode === 'audit-details'
                            ? 'جزئیات رخداد تغییرناپذیر ممیزی دسترسی.'
                            : view === 'received'
                              ? 'دعوت‌های خطاب به حساب تأییدشده را بررسی و در صورت معتبر بودن بپذیرید.'
                              : view === 'issued'
                                ? 'دعوت‌های صادرشده در محدوده‌ی انتخاب‌شده را پیگیری کنید.'
                                : view === 'roles'
                                  ? 'نقش‌های این محدوده و مجوزهای قابل واگذاری را مدیریت کنید.'
                                  : view === 'audit'
                                    ? 'رخدادهای ممیزی دسترسی را در محدوده‌ی انتخاب‌شده مشاهده کنید.'
                                    : 'اعضای محدوده را ببینید و دعوت تازه صادر کنید.'
        }
        headerActions={
          accessRouteMode === 'list' && view === 'staff' ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() =>
                router.push(`${accessBasePath}/staff/invite${scope ? `?${scopeQuery(scope)}` : ''}`)
              }
            >
              دعوت کارمند
            </button>
          ) : accessRouteMode === 'list' && view === 'roles' ? (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={!scope}
              onClick={() =>
                router.push(`${accessBasePath}/roles/new${scope ? `?${scopeQuery(scope)}` : ''}`)
              }
            >
              ایجاد نقش
            </button>
          ) : accessRouteMode === 'role-details' ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() =>
                router.push(
                  `${accessBasePath}/roles/${encodeURIComponent(routeResourceId)}/edit${scope ? `?${scopeQuery(scope)}` : ''}`,
                )
              }
            >
              ویرایش نقش
            </button>
          ) : accessRouteMode === 'staff-details' ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() =>
                router.push(
                  `${accessBasePath}/staff/${encodeURIComponent(routeResourceId)}/edit${scope ? `?${scopeQuery(scope)}` : ''}`,
                )
              }
            >
              تغییر نقش
            </button>
          ) : accessRouteMode !== 'list' ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => router.push(accessPathFor())}
            >
              بازگشت به فهرست
            </button>
          ) : undefined
        }
        toolbarActions={
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void loadData()}
            disabled={loading || !scope}
          >
            {loading ? 'در حال دریافت…' : 'بارگذاری محدوده'}
          </button>
        }
        pagination={listPagination}
      >
        <section className={styles.scopePanel} aria-labelledby="scope-heading">
          <div>
            <p className={styles.eyebrow}>محدوده‌ی کاری</p>
            <h2 id="scope-heading">انتخاب مجموعه یا شعبه</h2>
          </div>
          <label>
            سطح محدوده
            <select
              value={scopeType}
              onChange={(event) => setScopeType(event.target.value as Scope['type'])}
            >
              <option value="global">سراسری</option>
              <option value="organization">مجموعه</option>
              <option value="branch">شعبه</option>
            </select>
          </label>
          {scopeType !== 'global' && (
            <label>
              مجموعه
              <select
                value={organizationId}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setBranchId('');
                }}
                disabled={organizationsLoading || Boolean(organizationsError)}
                required
              >
                <option value="">
                  {organizationsLoading ? 'در حال دریافت مجموعه‌ها…' : 'انتخاب مجموعه'}
                </option>
                {!organizationsLoading && organizations.length === 0 && !organizationsError && (
                  <option value="" disabled>
                    مجموعه‌ی فعالی برای مدیریت پیدا نشد
                  </option>
                )}
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scopeType === 'branch' && (
            <label>
              شعبه
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                disabled={!organizationId || branchesLoading || Boolean(branchesError)}
                required
              >
                <option value="">
                  {branchesLoading
                    ? 'در حال دریافت شعب…'
                    : branches.length > 0
                      ? 'انتخاب شعبه'
                      : organizationId
                        ? 'شعبه‌ی فعالی موجود نیست'
                        : 'ابتدا مجموعه را انتخاب کنید'}
                </option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} · {branch.city}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scopeType === 'branch' && organizationId && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setBranchListRefresh((current) => current + 1)}
              disabled={branchesLoading}
            >
              {branchesLoading ? 'در حال دریافت شعب…' : 'تازه‌سازی فهرست شعب'}
            </button>
          )}
          {scopeType !== 'global' && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadOrganizations()}
              disabled={organizationsLoading}
            >
              {organizationsLoading ? 'در حال دریافت…' : 'تازه‌سازی فهرست مجموعه‌ها'}
            </button>
          )}
          <span className={styles.scopeSummary}>
            {scope
              ? labelScope(scope)
              : scopeType === 'branch' && branchesLoading
                ? 'در حال دریافت شعب فعال…'
                : scopeType === 'global'
                  ? 'دسترسی سراسری سامانه'
                  : 'یک مجموعه‌ی فعال را انتخاب کنید.'}
          </span>
        </section>

        {scopeType !== 'global' &&
          !organizationsLoading &&
          organizations.length === 0 &&
          !organizationsError && (
            <p className={styles.notice} role="status">
              مجموعه‌ی فعالی برای واگذاری دسترسی پیدا نشد. ابتدا از بخش «مجموعه‌ها» مجموعه را ایجاد
              یا فعال کنید.
            </p>
          )}
        {scopeType !== 'global' && organizationsError && (
          <p className={styles.error} role="alert">
            دریافت فهرست مجموعه‌ها ناموفق بود: {organizationsError}
          </p>
        )}
        {scopeType === 'branch' && branchesError && (
          <p className={styles.error} role="alert">
            دریافت فهرست شعب ناموفق بود: {branchesError}
          </p>
        )}
        {scope?.type === 'organization' && (
          <p className={styles.footerNote} role="note">
            برای معرفی مدیر مجموعه، در بخش «نقش‌ها و مجوزها» الگوی «مدیر مجموعه» را انتخاب و نقش را
            ایجاد کنید؛ سپس از فرم دعوت کارکنان شماره‌ی مدیر را وارد کنید. محدوده‌ی مجموعه همه‌ی
            مجوزهای tenant قابل‌واگذاری در کاتالوگ فعلی را روی خود مجموعه و شعب فعال فعلی و آینده‌ی
            آن اعمال می‌کند؛ دسترسی‌های سراسری سامانه به این نقش داده نمی‌شود. عضویت پس از پذیرش
            دعوت با شماره‌ی تأییدشده فعال می‌شود.
          </p>
        )}

        {error && (
          <div className={styles.error} role="alert">
            <p>{error}</p>
            {showStepUpLink && (
              <a href="/fa/security/mfa">
                اگر مجوز این فرمان را دارید، MFA تازه را در همین نشست تأیید کنید و سپس فرمان را
                دوباره اجرا کنید.
              </a>
            )}
          </div>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {view === 'received' && (
          <section
            className={styles.section}
            aria-labelledby="invitations-heading"
            aria-busy={loading}
          >
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>پذیرش صریح</p>
                <h2 id="invitations-heading">دعوت‌های دریافتی من</h2>
              </div>
              <span className={styles.count}>{pendingInvitations.length}</span>
            </div>
            {loading ? (
              <LoadingSkeleton label="در حال دریافت دعوت‌های دریافتی" rows={1} />
            ) : receivedInvitationItems.length === 0 ? (
              !error && <p className={styles.empty}>دعوت در انتظار پذیرش ندارید.</p>
            ) : (
              <div className={styles.cardGrid}>
                {receivedInvitationItems.map((invitation) => (
                  <article className={styles.card} key={invitation.id}>
                    <div>
                      <h3>{invitation.role.name}</h3>
                      <p>{invitationScopeLabel(invitation)}</p>
                      <small>
                        {invitation.maskedPhone} · اعتبار تا{' '}
                        {new Date(invitation.expiresAt).toLocaleDateString('fa-IR')}
                      </small>
                    </div>
                    {accessRouteMode === 'list' && (
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() =>
                          router.push(
                            `${accessBasePath}/invitations/received/${encodeURIComponent(invitation.id)}`,
                          )
                        }
                      >
                        جزئیات
                      </button>
                    )}
                    {invitation.roleChanged ? (
                      <p className={styles.warning}>
                        نقش پس از صدور دعوت تغییر کرده؛ از مدیر مجموعه دعوت جدید بخواهید.
                      </p>
                    ) : invitation.scopeStatus === 'inactive' ? (
                      <p className={styles.warning}>
                        مجموعه یا شعبه‌ی مقصد فعال نیست؛ پذیرش این دعوت متوقف شده است.
                      </p>
                    ) : invitation.scopeStatus === 'unavailable' ? (
                      <p className={styles.warning}>
                        وضعیت مقصد از سرویس مالک تأیید نشد؛ پیش از پذیرش دوباره تلاش کنید.
                      </p>
                    ) : (
                      <button
                        className={styles.primaryButton}
                        type="button"
                        onClick={() => void acceptInvitation(invitation)}
                      >
                        پذیرش دعوت
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'issued' && (
          <section
            className={styles.section}
            aria-labelledby="issued-invitations-heading"
            aria-busy={loading}
          >
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>مدیریت دعوت‌ها · {scope?.type ?? '—'}</p>
                <h2 id="issued-invitations-heading">دعوت‌های صادرشده در این محدوده</h2>
              </div>
              <span className={styles.count}>{scopedInvitations.length}</span>
            </div>
            {loading ? (
              <LoadingSkeleton label="در حال دریافت دعوت‌های صادرشده" rows={1} />
            ) : issuedInvitationItems.length === 0 ? (
              !error && <p className={styles.empty}>دعوت بازی در این محدوده ثبت نشده است.</p>
            ) : (
              <div className={styles.cardGrid}>
                {issuedInvitationItems.map((invitation) => (
                  <article className={styles.card} key={invitation.id}>
                    <div>
                      <h3>{invitation.role.name}</h3>
                      <p>{scopeLabel(invitation.scope)}</p>
                      <small>
                        {invitation.maskedPhone} · اعتبار تا{' '}
                        {new Date(invitation.expiresAt).toLocaleDateString('fa-IR')}
                      </small>
                    </div>
                    {accessRouteMode === 'list' && (
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() =>
                          router.push(
                            `${accessBasePath}/invitations/issued/${encodeURIComponent(invitation.id)}${scope ? `?${scopeQuery(scope)}` : ''}`,
                          )
                        }
                      >
                        جزئیات
                      </button>
                    )}
                    {(invitation.isExpired || invitation.roleChanged) && (
                      <p className={styles.warning}>
                        {invitation.isExpired
                          ? 'این دعوت منقضی شده است.'
                          : 'نقش پس از صدور دعوت تغییر کرده است.'}
                      </p>
                    )}
                    <button
                      className={styles.dangerButton}
                      type="button"
                      onClick={() => void revokeIssuedInvitation(invitation)}
                    >
                      لغو دعوت
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'staff' && accessRouteMode === 'staff-invite' && (
          <section
            className={styles.section}
            aria-labelledby="invite-staff-title"
            aria-busy={loading}
          >
            <h2 id="invite-staff-title">
              دعوت کارمند به {scope ? labelScope(scope) : 'محدوده‌ی انتخاب‌شده'}
            </h2>
            <form className={styles.form} onSubmit={(event) => void inviteStaff(event)}>
              <label>
                شماره‌ی موبایل با کد کشور
                <input
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+98912…"
                  value={invitePhone}
                  onChange={(event) => setInvitePhone(event.target.value)}
                  required
                />
              </label>
              <label>
                نقش
                <select
                  value={inviteRoleId}
                  onChange={(event) => setInviteRoleId(event.target.value)}
                  required
                >
                  <option value="">انتخاب نقش فعال</option>
                  {roles
                    .filter((role) => role.status === 'active')
                    .map((role) => (
                      <option value={role.id} key={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                دلیل دعوت (اختیاری)
                <textarea
                  value={inviteReason}
                  onChange={(event) => setInviteReason(event.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </label>
              <button className={styles.primaryButton} disabled={!scope || loading}>
                {loading ? 'در حال بارگذاری محدوده…' : 'ثبت دعوت ۷روزه'}
              </button>
            </form>
          </section>
        )}

        <div className={styles.grid}>
          {view === 'roles' && (
            <section className={styles.section} aria-labelledby="roles-heading" aria-busy={loading}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>
                    {scope?.type ?? '—'} · {roles.length} مورد
                  </p>
                  <h2 id="roles-heading">
                    {accessRouteMode === 'role-create'
                      ? 'ساخت نقش سفارشی'
                      : accessRouteMode === 'role-edit'
                        ? 'ویرایش نقش'
                        : accessRouteMode === 'role-details'
                          ? 'جزئیات نقش'
                          : 'نقش‌ها و مجوزها'}
                  </h2>
                </div>
              </div>
              {accessRouteMode === 'role-create' && (
                <form className={styles.form} onSubmit={(event) => void createRole(event)}>
                  <h3>ساخت نقش سفارشی</h3>
                  <label>
                    شروع از الگو
                    <select
                      value={selectedTemplate}
                      onChange={(event) => setSelectedTemplate(event.target.value)}
                    >
                      <option value="">انتخاب الگوی نقش (اختیاری)</option>
                      {templates.map((template) => (
                        <option value={template.key} key={template.key}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    نام نقش
                    <input
                      value={roleName}
                      onChange={(event) => setRoleName(event.target.value)}
                      minLength={2}
                      maxLength={80}
                      required
                    />
                  </label>
                  <fieldset className={styles.permissions}>
                    <legend>مجوزهای قابل واگذاری در این محدوده</legend>
                    {applicablePermissions.map((permission) => (
                      <label className={styles.checkRow} key={permission.key}>
                        <input
                          type="checkbox"
                          checked={rolePermissions.includes(permission.key)}
                          onChange={(event) =>
                            setRolePermissions((keys) =>
                              event.target.checked
                                ? [...keys, permission.key]
                                : keys.filter((key) => key !== permission.key),
                            )
                          }
                        />
                        <span>
                          <bdi>{permission.key}</bdi>
                          {permission.stepUp && <small>نیازمند MFA تازه</small>}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    دلیل ساخت نقش (الزامی؛ حداقل ۸ نویسه)
                    <textarea
                      value={roleReason}
                      onChange={(event) => setRoleReason(event.target.value)}
                      minLength={8}
                      maxLength={500}
                      rows={2}
                      required
                    />
                  </label>
                  <button
                    className={styles.primaryButton}
                    disabled={!scope || rolePermissions.length === 0}
                  >
                    ایجاد نقش
                  </button>
                </form>
              )}
              {accessRouteMode !== 'role-create' && (
                <div className={styles.list}>
                  {loading ? (
                    <LoadingSkeleton label="در حال دریافت نقش‌ها" rows={2} />
                  ) : roles.length === 0 ? (
                    !error && <p className={styles.empty}>نقشی برای این محدوده ثبت نشده است.</p>
                  ) : (
                    roleListItems.map((role) => {
                      const edit = roleEdits[role.id];
                      const roleEditReason = roleEditReasons[role.id] ?? '';
                      const rolePermissionsChanged =
                        edit !== undefined &&
                        [...edit.permissionKeys].sort().join('\u0000') !==
                          [...role.permissionKeys].sort().join('\u0000');
                      const roleEditReasonRequired =
                        edit !== undefined &&
                        (edit.status !== role.status || rolePermissionsChanged);
                      return (
                        <article className={styles.roleCard} key={role.id}>
                          <div className={styles.sectionHeading}>
                            <div>
                              <h3>{role.name}</h3>
                              <small>
                                {role.systemManaged ? 'نقش محافظت‌شده' : 'نقش سفارشی'} · نسخه{' '}
                                {role.version} · {role.permissionKeys.length} مجوز
                              </small>
                            </div>
                            <span
                              className={
                                role.status === 'active' ? styles.activeBadge : styles.inactiveBadge
                              }
                            >
                              {role.status === 'active' ? 'فعال' : 'غیرفعال'}
                            </span>
                          </div>
                          <details>
                            <summary>مشاهده‌ی مجوزها</summary>
                            <div className={styles.keyList}>
                              {role.permissionKeys.map((key) => (
                                <code key={key}>{key}</code>
                              ))}
                            </div>
                          </details>
                          {accessRouteMode !== 'role-details' && (
                            <button
                              className={styles.textButton}
                              type="button"
                              onClick={() =>
                                router.push(
                                  `${accessBasePath}/roles/${encodeURIComponent(role.id)}${scope ? `?${scopeQuery(scope)}` : ''}`,
                                )
                              }
                            >
                              جزئیات
                            </button>
                          )}
                          {accessRouteMode !== 'role-details' && !role.systemManaged && (
                            <>
                              {!edit ? (
                                <button
                                  className={styles.textButton}
                                  type="button"
                                  onClick={() => startRoleEdit(role)}
                                >
                                  ویرایش نقش
                                </button>
                              ) : (
                                <div className={styles.form}>
                                  <label>
                                    نام
                                    <input
                                      value={edit.name}
                                      onChange={(event) =>
                                        setRoleEdits((current) => ({
                                          ...current,
                                          [role.id]: { ...edit, name: event.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                  <label>
                                    وضعیت
                                    <select
                                      value={edit.status}
                                      onChange={(event) =>
                                        setRoleEdits((current) => ({
                                          ...current,
                                          [role.id]: {
                                            ...edit,
                                            status: event.target.value as Role['status'],
                                          },
                                        }))
                                      }
                                    >
                                      <option value="active">فعال</option>
                                      <option value="disabled">غیرفعال</option>
                                    </select>
                                  </label>
                                  <fieldset className={styles.permissions}>
                                    <legend>مجوزها</legend>
                                    {applicablePermissions.map((permission) => (
                                      <label className={styles.checkRow} key={permission.key}>
                                        <input
                                          type="checkbox"
                                          checked={edit.permissionKeys.includes(permission.key)}
                                          onChange={(event) =>
                                            setRoleEdits((current) => ({
                                              ...current,
                                              [role.id]: {
                                                ...edit,
                                                permissionKeys: event.target.checked
                                                  ? [...edit.permissionKeys, permission.key]
                                                  : edit.permissionKeys.filter(
                                                      (key) => key !== permission.key,
                                                    ),
                                              },
                                            }))
                                          }
                                        />
                                        <bdi>{permission.key}</bdi>
                                      </label>
                                    ))}
                                  </fieldset>
                                  <label>
                                    دلیل تغییر
                                    <textarea
                                      value={roleEditReason}
                                      onChange={(event) =>
                                        setRoleEditReasons((current) => ({
                                          ...current,
                                          [role.id]: event.target.value,
                                        }))
                                      }
                                      minLength={roleEditReasonRequired ? 8 : undefined}
                                      maxLength={500}
                                      rows={2}
                                      required={roleEditReasonRequired}
                                      aria-describedby={`role-edit-reason-hint-${role.id}`}
                                    />
                                    <small id={`role-edit-reason-hint-${role.id}`}>
                                      {roleEditReasonRequired
                                        ? 'برای تغییر مجوز یا وضعیت نقش، حداقل ۸ نویسه وارد کنید.'
                                        : 'برای تغییر نام اختیاری است؛ حداکثر ۵۰۰ نویسه.'}
                                    </small>
                                  </label>
                                  <button
                                    className={styles.primaryButton}
                                    type="button"
                                    onClick={() => void saveRole(role)}
                                  >
                                    ذخیره‌ی نسخه‌ی جدید
                                  </button>
                                  <button
                                    className={styles.secondaryButton}
                                    type="button"
                                    onClick={() => router.push(accessPathFor('roles'))}
                                  >
                                    انصراف
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          )}

          {view === 'staff' && accessRouteMode !== 'staff-invite' && (
            <section className={styles.section} aria-labelledby="staff-heading" aria-busy={loading}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>{staff.length} عضویت</p>
                  <h2 id="staff-heading">
                    {accessRouteMode === 'staff-edit'
                      ? 'تغییر نقش عضویت'
                      : accessRouteMode === 'staff-details'
                        ? 'جزئیات عضویت'
                        : 'کارکنان این محدوده'}
                  </h2>
                </div>
              </div>
              {accessRouteMode !== 'staff-edit' && (
                <label className={styles.reasonField}>
                  دلیل (برای تغییر دسترسی role، تغییر نقش عضویت، ایجاد/لغو override و لغو دائمی
                  عضویت اجباری)
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="برای عملیات عادی اختیاری است؛ برای فرمان‌های پرریسک دلیل حداقل ۸ نویسه‌ای وارد کنید."
                  />
                </label>
              )}
              <div className={styles.list}>
                {loading && <LoadingSkeleton label="در حال دریافت کارکنان این محدوده" rows={3} />}
                {staffRouteItems.map((member) => (
                  <article className={styles.staffCard} key={member.membershipId}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h3>{member.role.name}</h3>
                        <small>
                          {member.maskedPhone ?? member.userId} · {labelScope(member.scope)}
                        </small>
                      </div>
                      <span
                        className={
                          member.status === 'active' ? styles.activeBadge : styles.inactiveBadge
                        }
                      >
                        {member.status}
                      </span>
                    </div>
                    {accessRouteMode === 'staff-edit' && (
                      <label>
                        تغییر نقش
                        <select
                          value={staffRoleEdits[member.membershipId] ?? member.role.id}
                          onChange={(event) =>
                            setStaffRoleEdits((current) => ({
                              ...current,
                              [member.membershipId]: event.target.value,
                            }))
                          }
                        >
                          <option value={member.role.id}>{member.role.name} (فعلی)</option>
                          {roles
                            .filter(
                              (role) => role.id !== member.role.id && role.status === 'active',
                            )
                            .map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <div className={styles.actionRow}>
                      {member.status === 'active' && (
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => void changeStaffStatus(member, 'suspend')}
                        >
                          تعلیق
                        </button>
                      )}
                      {member.status === 'suspended' && (
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => void changeStaffStatus(member, 'reactivate')}
                        >
                          فعال‌سازی مجدد
                        </button>
                      )}
                      {member.status !== 'revoked' && (
                        <button
                          className={styles.dangerButton}
                          type="button"
                          onClick={() => void changeStaffStatus(member, 'revoke')}
                        >
                          لغو عضویت
                        </button>
                      )}
                      {accessRouteMode === 'list' && (
                        <>
                          <button
                            className={styles.textButton}
                            type="button"
                            onClick={() =>
                              router.push(
                                `${accessBasePath}/staff/${encodeURIComponent(member.membershipId)}${scope ? `?${scopeQuery(scope)}` : ''}`,
                              )
                            }
                          >
                            جزئیات
                          </button>
                          <button
                            className={styles.textButton}
                            type="button"
                            onClick={() =>
                              router.push(
                                `${accessBasePath}/staff/${encodeURIComponent(member.membershipId)}/edit${scope ? `?${scopeQuery(scope)}` : ''}`,
                              )
                            }
                          >
                            تغییر نقش
                          </button>
                        </>
                      )}
                      {accessRouteMode === 'staff-edit' && (
                        <button
                          className={styles.textButton}
                          type="button"
                          onClick={() => void changeStaffRole(member)}
                        >
                          اعمال نقش
                        </button>
                      )}
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() => void openOverrides(member)}
                        aria-expanded={openOverrideMembership === member.membershipId}
                      >
                        overrideها
                      </button>
                    </div>
                    {openOverrideMembership === member.membershipId && (
                      <div className={styles.overridePanel}>
                        <h4>مجوزهای اختصاصی این کارمند</h4>
                        {(overrides[member.membershipId] ?? []).map((override) => (
                          <div className={styles.overrideRow} key={override.id}>
                            <span>
                              <bdi>{override.permissionKey}</bdi> · {override.effect}
                              {override.revokedAt ? ' · لغوشده' : ''}
                            </span>
                            {!override.revokedAt && (
                              <button
                                className={styles.textButton}
                                type="button"
                                onClick={() => void revokeOverride(member, override)}
                              >
                                لغو
                              </button>
                            )}
                          </div>
                        ))}
                        <label>
                          مجوز
                          <select
                            value={overridePermission}
                            onChange={(event) => setOverridePermission(event.target.value)}
                          >
                            <option value="">انتخاب مجوز</option>
                            {applicablePermissions.map((permission) => (
                              <option value={permission.key} key={permission.key}>
                                {permission.key}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          اثر
                          <select
                            value={overrideEffect}
                            onChange={(event) =>
                              setOverrideEffect(event.target.value as 'allow' | 'deny')
                            }
                          >
                            <option value="deny">ممنوع‌سازی</option>
                            <option value="allow">افزودن دسترسی (فقط در حد واگذاری مجاز)</option>
                          </select>
                        </label>
                        <label>
                          انقضا (اختیاری)
                          <DateTimePickerField
                            value={overrideExpiry}
                            onChange={setOverrideExpiry}
                            title="زمان انقضای دسترسی"
                          />
                        </label>
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => void createOverride(member)}
                        >
                          ثبت override
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {!loading && staff.length === 0 && !error && (
                  <p className={styles.empty}>در این محدوده عضویتی ثبت نشده است.</p>
                )}
                {!loading &&
                  (accessRouteMode === 'staff-edit' || accessRouteMode === 'staff-details') &&
                  staffRouteItems.length === 0 && (
                    <p className={styles.empty} role="alert">
                      عضویت در فهرست مجاز این محدوده پیدا نشد.
                    </p>
                  )}
              </div>
            </section>
          )}
        </div>

        {view === 'audit' && (
          <section className={styles.section} aria-labelledby="audit-heading" aria-busy={loading}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>ثبت تغییرناپذیر · {audit.length} رویداد اخیر</p>
                <h2 id="audit-heading">گزارش ممیزی دسترسی</h2>
                <small>
                  خواندن این گزارش نیازمند audit.read در محدوده‌ی مجاز است؛ MFA step-up لازم نیست.
                </small>
              </div>
            </div>
            {auditError && (
              <p className={styles.warning} role="status">
                {auditError}
              </p>
            )}
            <div className={styles.auditList}>
              {loading ? (
                <LoadingSkeleton label="در حال دریافت رخدادهای ممیزی" rows={3} />
              ) : (
                auditListItems.map((item) => (
                  <article className={styles.auditRow} key={item.id}>
                    <span
                      className={
                        item.outcome === 'succeeded' ? styles.activeBadge : styles.inactiveBadge
                      }
                    >
                      {item.outcome === 'succeeded' ? 'موفق' : 'ردشده'}
                    </span>
                    <div>
                      <strong>
                        <bdi>{item.action}</bdi>
                      </strong>
                      <small>
                        {item.actorType === 'system' ? item.actorLabel : item.actorUserId}
                        {item.reason ? ` · ${item.reason}` : ''}
                      </small>
                    </div>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString('fa-IR')}
                    </time>
                    {accessRouteMode === 'list' && (
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() =>
                          router.push(
                            `${accessBasePath}/audit/${encodeURIComponent(item.id)}${scope ? `?${scopeQuery(scope)}` : ''}`,
                          )
                        }
                      >
                        جزئیات
                      </button>
                    )}
                  </article>
                ))
              )}
              {auditListItems.length === 0 && !loading && !auditError && (
                <p className={styles.empty}>رخداد ممیزی در این محدوده ثبت نشده است.</p>
              )}
            </div>
          </section>
        )}

        <p className={styles.footerNote}>
          نشست مدیریتی از سیاست IAM حداکثر ۱۲ ساعت اعتبار دارد. MFA در ورود اجباری نیست و فقط
          فرمان‌های پرریسک درخواست step-up می‌کنند؛ تغییر عامل، عضویت یا مجوز همچنان در سرور بررسی
          می‌شود.
        </p>

        {pendingConfirmation && (
          <SystemConfirmDialog
            title={
              pendingConfirmation.kind === 'membership' ? 'لغو عضویت کارکنان' : 'لغو مجوز اختصاصی'
            }
            description={
              pendingConfirmation.kind === 'membership'
                ? `با تأیید، دسترسی عضویت «${pendingConfirmation.member.role.name}» در ${labelScope(pendingConfirmation.member.scope)} متوقف می‌شود.`
                : `مجوز «${pendingConfirmation.override.permissionKey}» در ${labelScope(pendingConfirmation.override.scope)} فوراً لغو می‌شود.`
            }
            confirmLabel={pendingConfirmation.kind === 'membership' ? 'لغو عضویت' : 'لغو مجوز'}
            onCancel={() => setPendingConfirmation(null)}
            onConfirm={() => void confirmPendingAction()}
          />
        )}
      </ManagementListPage>
    </main>
  );
}
