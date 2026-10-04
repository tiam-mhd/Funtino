'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import styles from './AccessManagement.module.css';

type Scope =
  | { type: 'global' }
  | { type: 'organization'; organizationId: string }
  | { type: 'branch'; organizationId: string; branchId: string };
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
  reason?: string;
};
type AuditItem = {
  id: string;
  actorType: 'user' | 'system';
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iranPhonePattern = /^\+?[1-9][0-9]{7,14}$/;

function scopeQuery(scope: Scope): string {
  const query = new URLSearchParams({ scopeType: scope.type });
  if (scope.type !== 'global') query.set('organizationId', scope.organizationId);
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  return query.toString();
}

function scopeLabel(scope: Scope): string {
  if (scope.type === 'global') return 'سراسری';
  if (scope.type === 'organization') return `مجموعه ${scope.organizationId}`;
  return `شعبه ${scope.branchId}`;
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
  const [auditError, setAuditError] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [roleName, setRoleName] = useState('');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteReason, setInviteReason] = useState('');
  const [reason, setReason] = useState('');
  const [roleEdits, setRoleEdits] = useState<
    Record<string, { name: string; status: Role['status']; permissionKeys: string[] }>
  >({});
  const [staffRoleEdits, setStaffRoleEdits] = useState<Record<string, string>>({});
  const [openOverrideMembership, setOpenOverrideMembership] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override[]>>({});
  const [overridePermission, setOverridePermission] = useState('');
  const [overrideEffect, setOverrideEffect] = useState<'allow' | 'deny'>('deny');
  const [overrideExpiry, setOverrideExpiry] = useState('');

  const scope = useMemo<Scope | null>(() => {
    if (scopeType === 'global') return { type: 'global' };
    if (!uuidPattern.test(organizationId)) return null;
    if (scopeType === 'organization') return { type: 'organization', organizationId };
    if (!uuidPattern.test(branchId)) return null;
    return { type: 'branch', organizationId, branchId };
  }, [scopeType, organizationId, branchId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    setAuditError('');
    setNotice('');
    const pendingPromise = apiRequest<{ data: Invitation[] }>(
      '/api/v1/operations/staff/invitations/pending',
    );
    const permissionPromise = apiRequest<Permission[]>('/api/v1/operations/permissions');
    if (!scope) {
      setError(
        scopeType === 'branch'
          ? 'شناسه‌ی معتبر مجموعه و شعبه را وارد کنید.'
          : 'شناسه‌ی معتبر مجموعه را وارد کنید.',
      );
      const [pending, permissionResult] = await Promise.allSettled([
        pendingPromise,
        permissionPromise,
      ]);
      if (pending.status === 'fulfilled') setPendingInvitations(pending.value.data);
      if (permissionResult.status === 'fulfilled') setPermissions(permissionResult.value);
      setScopedInvitations([]);
      setLoading(false);
      return;
    }
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
          ? 'برای مشاهده‌ی ممیزی، تأیید مجدد MFA در همین نشست لازم است.'
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
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const template = templates.find((item) => item.key === selectedTemplate);
    if (!template) return;
    setRoleName(template.name);
    setRolePermissions([...template.permissionKeys]);
  }, [selectedTemplate, templates]);

  async function perform(label: string, work: () => Promise<unknown>) {
    setError('');
    setNotice('');
    try {
      await work();
      await loadData();
      setNotice(label);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetScope = scope;
    if (!targetScope) {
      setError('شناسه‌ی محدوده معتبر نیست.');
      return;
    }
    await perform('نقش با موفقیت ثبت شد.', async () => {
      await apiRequest('/api/v1/operations/roles', {
        method: 'POST',
        headers: { 'Idempotency-Key': freshIdempotencyKey() },
        body: {
          name: roleName,
          scope: targetScope,
          permissionKeys: rolePermissions,
          reason: roleReason,
        },
      });
      setRoleName('');
      setRolePermissions([]);
      setRoleReason('');
      setSelectedTemplate('');
    });
  }

  async function saveRole(role: Role) {
    const edit = roleEdits[role.id];
    if (!edit || !reason.trim()) {
      setError('برای ذخیره‌ی نقش، دلیل تغییر را وارد کنید.');
      return;
    }
    await perform('تغییرات نقش ذخیره شد.', async () => {
      await apiRequest(`/api/v1/operations/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': freshIdempotencyKey(), 'If-Match': `"${role.version}"` },
        body: { ...edit, reason },
      });
      setRoleEdits((current) => {
        const next = { ...current };
        delete next[role.id];
        return next;
      });
      setReason('');
    });
  }

  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetScope = scope;
    if (!targetScope) {
      setError('شناسه‌ی محدوده معتبر نیست.');
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
            reason: inviteReason,
          },
        });
        setInvitePhone('');
        setInviteRoleId('');
        setInviteReason('');
      },
    );
  }

  async function changeStaffStatus(member: Staff, action: 'suspend' | 'reactivate' | 'revoke') {
    if (!reason.trim()) {
      setError('برای تغییر وضعیت عضویت، دلیل را وارد کنید.');
      return;
    }
    const labels = {
      suspend: 'عضویت تعلیق شد.',
      reactivate: 'عضویت دوباره فعال شد.',
      revoke: 'عضویت لغو شد.',
    };
    await perform(labels[action], async () => {
      await apiRequest(`/api/v1/operations/staff/${member.membershipId}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': freshIdempotencyKey() },
        body: { reason },
      });
      setReason('');
    });
  }

  async function changeStaffRole(member: Staff) {
    const roleId = staffRoleEdits[member.membershipId];
    if (!roleId || !reason.trim()) {
      setError('نقش جدید و دلیل تغییر را مشخص کنید.');
      return;
    }
    await perform('نقش کارمند تغییر کرد.', async () => {
      await apiRequest(`/api/v1/operations/staff/${member.membershipId}`, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': freshIdempotencyKey(), 'If-Match': `"${member.version}"` },
        body: { roleId, reason },
      });
      setStaffRoleEdits((current) => {
        const next = { ...current };
        delete next[member.membershipId];
        return next;
      });
      setReason('');
    });
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
    if (!scope || !overridePermission || !reason.trim()) {
      setError('مجوز، محدوده و دلیل override را تکمیل کنید.');
      return;
    }
    await perform('override دسترسی ثبت شد.', async () => {
      await apiRequest(`/api/v1/operations/staff/${member.membershipId}/permission-overrides`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': freshIdempotencyKey() },
        body: {
          permission: overridePermission,
          effect: overrideEffect,
          scope,
          ...(overrideExpiry ? { expiresAt: new Date(overrideExpiry).toISOString() } : {}),
          reason,
        },
      });
      setReason('');
      setOverridePermission('');
      setOverrideExpiry('');
      const result = await apiRequest<OverridePage>(
        `/api/v1/operations/staff/${member.membershipId}/permission-overrides`,
      );
      setOverrides((current) => ({ ...current, [member.membershipId]: result.data }));
    });
  }

  async function revokeOverride(member: Staff, override: Override) {
    if (!reason.trim()) {
      setError('برای لغو override دلیل را وارد کنید.');
      return;
    }
    await perform('override لغو شد.', async () => {
      await apiRequest(
        `/api/v1/operations/staff/${member.membershipId}/permission-overrides/${override.id}`,
        {
          method: 'DELETE',
          headers: { 'Idempotency-Key': freshIdempotencyKey() },
          body: { reason },
        },
      );
      setReason('');
      const result = await apiRequest<OverridePage>(
        `/api/v1/operations/staff/${member.membershipId}/permission-overrides`,
      );
      setOverrides((current) => ({ ...current, [member.membershipId]: result.data }));
    });
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
    if (!reason.trim()) {
      setError('برای لغو دعوت، دلیل قابل ممیزی را وارد کنید.');
      return;
    }
    await perform('دعوت صادرشده لغو شد.', async () => {
      await apiRequest(`/api/v1/operations/staff/invitations/${invitation.id}/revoke`, {
        method: 'POST',
        headers: { 'Idempotency-Key': freshIdempotencyKey() },
        body: { reason },
      });
      setReason('');
    });
  }

  const applicablePermissions = permissions.filter(
    (permission) => permission.delegable && permission.scopes.includes(scope?.type ?? 'global'),
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a className={styles.backLink} href="/fa">
            بازگشت به نمای کلی
          </a>
          <p className={styles.eyebrow}>کنترل مرکزی · امنیت و دسترسی</p>
          <h1>مدیریت نقش‌ها و کارکنان</h1>
          <p className={styles.lead}>
            مجوزها در سرور ارزیابی می‌شوند؛ هر تغییر حساس به تأیید مجدد MFA و ثبت دلیل نیاز دارد.
          </p>
        </div>
        <div className={styles.headerLinks}>
          <a className={styles.mfaLink} href="/fa/mfa">
            تنظیم تأیید دومرحله‌ای
          </a>
          <a className={styles.mfaLink} href="/fa/security/session-policy">
            مدت نشست کارکنان
          </a>
        </div>
      </header>

      <section className={styles.scopePanel} aria-labelledby="scope-heading">
        <div>
          <p className={styles.eyebrow}>محدوده‌ی کاری</p>
          <h2 id="scope-heading">مشاهده‌ی امن و محدودشده</h2>
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
            شناسه‌ی مجموعه
            <input
              dir="ltr"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value.trim())}
              placeholder="UUID مجموعه"
              autoComplete="off"
            />
          </label>
        )}
        {scopeType === 'branch' && (
          <label>
            شناسه‌ی شعبه
            <input
              dir="ltr"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value.trim())}
              placeholder="UUID شعبه"
              autoComplete="off"
            />
          </label>
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
          {scope ? scopeLabel(scope) : 'برای مشاهده، شناسه‌های معتبر را وارد کنید.'}
        </span>
      </section>

      <p className={styles.warning} role="note">
        اعتبارسنجی مالکیت مجموعه و شعبه هنوز به سرویس Organization/Branch متصل نیست. شناسه‌های
        واردشده در این مرحله opaque هستند؛ تغییرات محدوده‌ی سازمان/شعبه در production عمداً با خطای
        fail-closed مسدود می‌شوند و داده‌ی این محیط نباید به production منتقل شود.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && (
        <p className={styles.loading} role="status">
          در حال دریافت اطلاعات…
        </p>
      )}

      <section className={styles.section} aria-labelledby="invitations-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>پذیرش صریح</p>
            <h2 id="invitations-heading">دعوت‌های دریافتی من</h2>
          </div>
          <span className={styles.count}>{pendingInvitations.length}</span>
        </div>
        {pendingInvitations.length === 0 ? (
          <p className={styles.empty}>دعوت در انتظار پذیرش ندارید.</p>
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

      <section className={styles.section} aria-labelledby="issued-invitations-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>مدیریت دعوت‌ها · {scope?.type ?? '—'}</p>
            <h2 id="issued-invitations-heading">دعوت‌های صادرشده در این محدوده</h2>
          </div>
          <span className={styles.count}>{scopedInvitations.length}</span>
        </div>
        {scopedInvitations.length === 0 ? (
          <p className={styles.empty}>دعوت بازی در این محدوده وجود ندارد یا مجوز مشاهده ندارید.</p>
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
        <section className={styles.section} aria-labelledby="roles-heading">
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
                <option value="">انتخاب الگوی کم‌دسترسی (اختیاری)</option>
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
              دلیل ثبت نقش
              <textarea
                value={roleReason}
                onChange={(event) => setRoleReason(event.target.value)}
                minLength={8}
                maxLength={500}
                required
                rows={2}
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
            {roles.map((role) => {
              const edit = roleEdits[role.id];
              return (
                <article className={styles.roleCard} key={role.id}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <h3>{role.name}</h3>
                      <small>
                        {role.systemManaged ? 'نقش محافظت‌شده' : 'نقش سفارشی'} · نسخه {role.version}{' '}
                        · {role.permissionKeys.length} مجوز
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
            })}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="staff-heading">
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
              دلیل دعوت
              <textarea
                value={inviteReason}
                onChange={(event) => setInviteReason(event.target.value)}
                minLength={8}
                maxLength={500}
                required
                rows={2}
              />
            </label>
            <button className={styles.primaryButton} disabled={!scope}>
              ثبت دعوت ۷روزه
            </button>
          </form>
          <label className={styles.reasonField}>
            دلیل عملیات کارکنان / override
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={8}
              maxLength={500}
              rows={2}
              placeholder="برای هر تغییر مدیریتی دلیل قابل ممیزی ثبت کنید."
            />
          </label>
          <div className={styles.list}>
            {staff.map((member) => (
              <article className={styles.staffCard} key={member.membershipId}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h3>{member.role.name}</h3>
                    <small>
                      {member.maskedPhone ?? member.userId} · {scopeLabel(member.scope)}
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
                      <input
                        type="datetime-local"
                        value={overrideExpiry}
                        onChange={(event) => setOverrideExpiry(event.target.value)}
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
            {staff.length === 0 && (
              <p className={styles.empty}>در این محدوده عضویتی پیدا نشد یا مجوز مشاهده ندارید.</p>
            )}
          </div>
        </section>
      </div>

      <section className={styles.section} aria-labelledby="audit-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>ثبت تغییرناپذیر · {audit.length} رویداد اخیر</p>
            <h2 id="audit-heading">گزارش ممیزی دسترسی</h2>
            <small>خواندن این گزارش به مجوز audit.read و MFA تازه نیاز دارد.</small>
          </div>
        </div>
        {auditError && (
          <p className={styles.warning} role="status">
            {auditError} <a href="/fa/mfa">رفتن به تأیید دومرحله‌ای</a>
          </p>
        )}
        <div className={styles.auditList}>
          {audit.map((item) => (
            <article className={styles.auditRow} key={item.id}>
              <span
                className={item.outcome === 'succeeded' ? styles.activeBadge : styles.inactiveBadge}
              >
                {item.outcome === 'succeeded' ? 'موفق' : 'ردشده'}
              </span>
              <div>
                <strong>
                  <bdi>{item.action}</bdi>
                </strong>
                <small>
                  {item.actorType === 'system' ? item.actorLabel : item.actorUserId} · {item.reason}
                </small>
              </div>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString('fa-IR')}
              </time>
            </article>
          ))}
          {audit.length === 0 && <p className={styles.empty}>رخدادی در دسترس نیست.</p>}
        </div>
      </section>

      <p className={styles.footerNote}>
        نشست ورود فعلی حداکثر ۳۰ روزه است؛ عملیات حساس به MFA تأییدشده در همان نشست و حداکثر ۵ دقیقه
        قبل نیاز دارد. غیرفعال‌سازی عامل یا تغییر نسخه‌ی آن، اثبات‌های قبلی را بی‌اعتبار می‌کند.
      </p>
    </main>
  );
}
