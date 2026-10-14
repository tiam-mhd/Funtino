'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { DateTimePickerField } from '@funtino/design-system';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import { SystemPageHeader } from '../../components/system-shell/SystemPageHeader';
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

export function AccessManagement() {
  const [scopeType, setScopeType] = useState<Scope['type']>('global');
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [scopedInvitations, setScopedInvitations] = useState<ScopedInvitation[]>([]);
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
      apiRequest<StaffPage>(`/api/v1/operations/staff?${query}`),
      apiRequest<ScopedInvitationPage>(`/api/v1/operations/staff/invitations?${query}`),
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
    if (staffResult.status === 'fulfilled') setStaff(staffResult.value.data);
    if (scopedInvitationsResult.status === 'fulfilled')
      setScopedInvitations(scopedInvitationsResult.value.data);
    if (templateResult.status === 'fulfilled') setTemplates(templateResult.value.data);
    if (auditResult.status === 'fulfilled') {
      setAudit(auditResult.value.data);
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

  async function perform(label: string, work: () => Promise<unknown>, mayRequireStepUp = false) {
    setError('');
    setNotice('');
    setShowStepUpLink(false);
    try {
      await work();
      await loadData();
      setNotice(label);
    } catch (caught) {
      setError(messageFor(caught));
      setShowStepUpLink(
        mayRequireStepUp && caught instanceof ApiRequestError && caught.status === 403,
      );
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
    await perform(
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
    await perform(
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
    await perform(
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

  return (
    <main className={styles.page}>
      <SystemPageHeader
        eyebrow="کنترل مرکزی · امنیت و دسترسی"
        title="مدیریت نقش‌ها و کارکنان"
        description="نقش‌ها، عضویت‌ها، دعوت‌ها و رویدادهای ممیزی را در محدوده‌ی انتخاب‌شده مدیریت کنید. مجوز نهایی در سرور بررسی می‌شود؛ فرمان‌های پرریسک تأیید MFA و تغییر مؤثر دسترسی دلیل می‌خواهد."
      />

      <nav className={styles.pageNav} aria-label="رفتن به بخش‌های مدیریت دسترسی">
        <a href="#scope-heading">محدوده</a>
        <a href="#invitations-heading">دعوت‌های دریافتی</a>
        <a href="#issued-invitations-heading">دعوت‌های صادرشده</a>
        <a href="#roles-heading">نقش‌ها</a>
        <a href="#staff-heading">کارکنان</a>
        <a href="#audit-heading">گزارش ممیزی</a>
      </nav>

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
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void loadData()}
          disabled={loading || !scope}
        >
          بارگذاری محدوده
        </button>
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
            مجموعه‌ی فعالی برای واگذاری دسترسی پیدا نشد. ابتدا از بخش «مجموعه‌ها» مجموعه را ایجاد یا
            فعال کنید.
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
          مجوزهای tenant قابل‌واگذاری در کاتالوگ فعلی را روی خود مجموعه و شعب فعال فعلی و آینده‌ی آن
          اعمال می‌کند؛ دسترسی‌های سراسری سامانه به این نقش داده نمی‌شود. عضویت پس از پذیرش دعوت با
          شماره‌ی تأییدشده فعال می‌شود.
        </p>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          {showStepUpLink && (
            <a href="/fa/security/mfa">
              اگر مجوز این فرمان را دارید، MFA تازه را در همین نشست تأیید کنید و سپس فرمان را دوباره
              اجرا کنید.
            </a>
          )}
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <section className={styles.section} aria-labelledby="invitations-heading" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>پذیرش صریح</p>
            <h2 id="invitations-heading">دعوت‌های دریافتی من</h2>
          </div>
          <span className={styles.count}>{pendingInvitations.length}</span>
        </div>
        {loading ? (
          <LoadingSkeleton label="در حال دریافت دعوت‌های دریافتی" rows={1} />
        ) : pendingInvitations.length === 0 ? (
          !error && <p className={styles.empty}>دعوت در انتظار پذیرش ندارید.</p>
        ) : (
          <div className={styles.cardGrid}>
            {pendingInvitations.map((invitation) => (
              <article className={styles.card} key={invitation.id}>
                <div>
                  <h3>{invitation.role.name}</h3>
                  <p>{invitationScopeLabel(invitation)}</p>
                  <small>
                    {invitation.maskedPhone} · اعتبار تا{' '}
                    {new Date(invitation.expiresAt).toLocaleDateString('fa-IR')}
                  </small>
                </div>
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
        ) : scopedInvitations.length === 0 ? (
          !error && <p className={styles.empty}>دعوت بازی در این محدوده ثبت نشده است.</p>
        ) : (
          <div className={styles.cardGrid}>
            {scopedInvitations.map((invitation) => (
              <article className={styles.card} key={invitation.id}>
                <div>
                  <h3>{invitation.role.name}</h3>
                  <p>{scopeLabel(invitation.scope)}</p>
                  <small>
                    {invitation.maskedPhone} · اعتبار تا{' '}
                    {new Date(invitation.expiresAt).toLocaleDateString('fa-IR')}
                  </small>
                </div>
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

      <div className={styles.grid}>
        <section className={styles.section} aria-labelledby="roles-heading" aria-busy={loading}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>
                {scope?.type ?? '—'} · {roles.length} مورد
              </p>
              <h2 id="roles-heading">نقش‌ها و مجوزها</h2>
            </div>
          </div>
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
          <div className={styles.list}>
            {loading ? (
              <LoadingSkeleton label="در حال دریافت نقش‌ها" rows={2} />
            ) : roles.length === 0 ? (
              !error && <p className={styles.empty}>نقشی برای این محدوده ثبت نشده است.</p>
            ) : (
              roles.map((role) => {
                const edit = roleEdits[role.id];
                const roleEditReason = roleEditReasons[role.id] ?? '';
                const rolePermissionsChanged =
                  edit !== undefined &&
                  [...edit.permissionKeys].sort().join('\u0000') !==
                    [...role.permissionKeys].sort().join('\u0000');
                const roleEditReasonRequired =
                  edit !== undefined && (edit.status !== role.status || rolePermissionsChanged);
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
                    {!role.systemManaged && (
                      <>
                        {!edit ? (
                          <button
                            className={styles.textButton}
                            type="button"
                            onClick={() =>
                              setRoleEdits((current) => ({
                                ...current,
                                [role.id]: {
                                  name: role.name,
                                  status: role.status,
                                  permissionKeys: [...role.permissionKeys],
                                },
                              }))
                            }
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
                          </div>
                        )}
                      </>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="staff-heading" aria-busy={loading}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{staff.length} عضویت</p>
              <h2 id="staff-heading">کارکنان این محدوده</h2>
            </div>
          </div>
          <form className={styles.form} onSubmit={(event) => void inviteStaff(event)}>
            <h3>دعوت کارمند</h3>
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
            <button className={styles.primaryButton} disabled={!scope}>
              ثبت دعوت ۷روزه
            </button>
          </form>
          <label className={styles.reasonField}>
            دلیل (برای تغییر دسترسی role، تغییر نقش عضویت، ایجاد/لغو override و لغو دائمی عضویت
            اجباری)
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="برای عملیات عادی اختیاری است؛ برای فرمان‌های پرریسک دلیل حداقل ۸ نویسه‌ای وارد کنید."
            />
          </label>
          <div className={styles.list}>
            {loading && <LoadingSkeleton label="در حال دریافت کارکنان این محدوده" rows={3} />}
            {staff.map((member) => (
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
                      .filter((role) => role.id !== member.role.id && role.status === 'active')
                      .map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                  </select>
                </label>
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
                  <button
                    className={styles.textButton}
                    type="button"
                    onClick={() => void changeStaffRole(member)}
                  >
                    اعمال نقش
                  </button>
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
          </div>
        </section>
      </div>

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
            audit.map((item) => (
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
              </article>
            ))
          )}
          {audit.length === 0 && !loading && !auditError && (
            <p className={styles.empty}>رخداد ممیزی در این محدوده ثبت نشده است.</p>
          )}
        </div>
      </section>

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
    </main>
  );
}
