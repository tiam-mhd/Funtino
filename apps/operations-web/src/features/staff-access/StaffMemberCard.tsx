'use client';

import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { Button, DateTimePickerField, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import type { OperationsScope } from '../../lib/auth/operations-access';
import {
  changeOperationsStaffRole,
  changeOperationsStaffStatus,
  createStaffPermissionOverride,
  freshIdempotencyKey,
  listStaffPermissionOverrides,
  revokeStaffPermissionOverride,
  type OperationsAccessRole,
  type OperationsPermission,
  type OperationsStaffMember,
  type PermissionOverride,
} from '../../lib/api/operations-staff';
import styles from './StaffAccessManager.module.css';

type StaffMemberCardProps = {
  member: OperationsStaffMember;
  scope: OperationsScope;
  roles: OperationsAccessRole[];
  permissions: OperationsPermission[];
  actionsDisabled: boolean;
  onSensitiveAction: (label: string, action: () => Promise<void>, requiresStepUp: boolean) => void;
  onSessionExpired: () => void;
};

export function StaffMemberCard(props: StaffMemberCardProps) {
  const {
    member,
    scope,
    roles,
    permissions,
    actionsDisabled,
    onSensitiveAction,
    onSessionExpired,
  } = props;
  const [roleId, setRoleId] = useState(member.role.id);
  const [roleReason, setRoleReason] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  const [overrideLoadState, setOverrideLoadState] = useState<
    'idle' | 'loading' | 'loaded' | 'error'
  >('idle');
  const [overrideError, setOverrideError] = useState('');
  const [overrideNotice, setOverrideNotice] = useState('');
  const [permissionKey, setPermissionKey] = useState('');
  const [effect, setEffect] = useState<'deny' | 'allow'>('deny');
  const [expiresAt, setExpiresAt] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const loadedOnce = useRef(false);
  const retryKeys = useRef(new Map<string, { fingerprint: string; key: string }>());

  useEffect(() => {
    setRoleId(member.role.id);
  }, [member.role.id]);

  const assignableRoles = roles.filter(
    (role) =>
      role.status === 'active' &&
      !role.systemManaged &&
      isRoleAssignableToMembership(role.scope, member.scope),
  );
  const delegablePermissions = permissions.filter(
    (permission) => permission.delegable && permission.scopes.includes(scope.type),
  );
  const canEditMembership = member.status === 'active' || member.status === 'suspended';

  function keyFor(action: string, fingerprint: string): string {
    const existing = retryKeys.current.get(action);
    if (existing?.fingerprint === fingerprint) return existing.key;
    const key = freshIdempotencyKey();
    retryKeys.current.set(action, { fingerprint, key });
    return key;
  }

  function completeKey(action: string) {
    retryKeys.current.delete(action);
  }

  async function refreshOverrides() {
    setOverrideLoadState('loading');
    setOverrideError('');
    try {
      const result = await listStaffPermissionOverrides(member.membershipId);
      setOverrides(result.data);
      setOverrideLoadState('loaded');
      loadedOnce.current = true;
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) {
        onSessionExpired();
        return;
      }
      setOverrideLoadState('error');
      setOverrideError(messageFor(failure));
    }
  }

  async function handleDetailsToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && !loadedOnce.current && overrideLoadState !== 'loading') {
      await refreshOverrides();
    }
  }

  function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = roleReason.trim();
    if (!canEditMembership || roleId === member.role.id || reason.length < 8) return;
    const actionKey = 'role';
    const fingerprint = JSON.stringify({ roleId, reason, version: member.version });
    const key = keyFor(actionKey, fingerprint);
    onSensitiveAction(
      'نقش کارمند تغییر کرد.',
      async () => {
        await changeOperationsStaffRole(member, roleId, reason, key);
        completeKey(actionKey);
        setRoleReason('');
      },
      true,
    );
  }

  function submitStatus(action: 'suspend' | 'reactivate') {
    const reason = statusReason.trim();
    const actionKey = `status:${action}`;
    const fingerprint = JSON.stringify({ reason, action });
    const key = keyFor(actionKey, fingerprint);
    onSensitiveAction(
      action === 'suspend' ? 'عضویت کارمند تعلیق شد.' : 'عضویت کارمند دوباره فعال شد.',
      async () => {
        await changeOperationsStaffStatus(member.membershipId, action, reason || undefined, key);
        completeKey(actionKey);
        setStatusReason('');
      },
      false,
    );
  }

  function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = overrideReason.trim();
    const type = resourceType.trim();
    const id = resourceId.trim();
    if (!permissionKey || reason.length < 8 || Boolean(type) !== Boolean(id)) {
      setOverrideError('مجوز، دلیل حداقل ۸ نویسه و اطلاعات منبع به‌صورت جفتی لازم است.');
      return;
    }

    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) {
      setOverrideError('زمان انقضا باید در آینده باشد.');
      return;
    }

    const input = {
      permission: permissionKey,
      effect,
      scope,
      ...(type && id ? { resource: { type, id } } : {}),
      ...(expiry ? { expiresAt: expiry.toISOString() } : {}),
      reason,
    };
    const actionKey = 'override:create';
    const key = keyFor(actionKey, JSON.stringify(input));
    setOverrideError('');
    setOverrideNotice('');
    onSensitiveAction(
      'استثنای دسترسی ثبت شد.',
      async () => {
        await createStaffPermissionOverride(member.membershipId, input, key);
        completeKey(actionKey);
        setOverrideReason('');
        setExpiresAt('');
        setResourceType('');
        setResourceId('');
        await refreshOverrides();
        setOverrideNotice('تغییر ثبت شد؛ نتیجه‌ی مجوز در درخواست بعدی و سمت سرور ارزیابی می‌شود.');
      },
      true,
    );
  }

  function revokeOverride(override: PermissionOverride) {
    const reason = (revokeReasons[override.id] ?? '').trim();
    if (reason.length < 8) {
      setOverrideError('برای لغو استثنا، دلیل حداقل ۸ نویسه وارد کنید.');
      return;
    }
    const actionKey = `override:revoke:${override.id}`;
    const key = keyFor(actionKey, reason);
    setOverrideError('');
    onSensitiveAction(
      'استثنای دسترسی لغو شد.',
      async () => {
        await revokeStaffPermissionOverride(member.membershipId, override.id, reason, key);
        completeKey(actionKey);
        setRevokeReasons((current) => ({ ...current, [override.id]: '' }));
        await refreshOverrides();
        setOverrideNotice('استثنا لغو شد و در بررسی‌های مجوز بعدی اعمال نمی‌شود.');
      },
      true,
    );
  }

  return (
    <Surface className={styles.memberCard}>
      <div className={styles.memberHeader}>
        <div className={styles.memberIdentity}>
          <strong>{safeMemberName(member)}</strong>
          <span>
            {member.maskedPhone ? `${member.maskedPhone} · ` : ''}
            {member.role.name} · عضویت در سطح {scopeLabel(member.scope)}
          </span>
        </div>
        <span className={`${styles.statusBadge} ${styles[`status_${member.status}`]}`}>
          {statusLabel(member.status)}
        </span>
      </div>

      {member.status === 'pending' ? (
        <p className={styles.explainer}>عضویت تا پذیرش دعوت با شماره‌ی تأییدشده فعال نمی‌شود.</p>
      ) : member.status === 'revoked' ? (
        <p className={styles.explainer}>
          این عضویت لغو شده و از این صفحه قابل فعال‌سازی مجدد نیست.
        </p>
      ) : (
        <details
          className={styles.memberDetails}
          onToggle={(event) => void handleDetailsToggle(event)}
        >
          <summary>مدیریت نقش، وضعیت و دسترسی‌های فردی</summary>
          <div className={styles.memberControls}>
            <form className={styles.inlineForm} onSubmit={submitRole}>
              <h3>تغییر نقش</h3>
              <label className={styles.field}>
                نقش فعال در این محدوده
                <select
                  disabled={actionsDisabled || !canEditMembership}
                  onChange={(event) => setRoleId(event.currentTarget.value)}
                  required
                  value={roleId}
                >
                  {!assignableRoles.some((role) => role.id === roleId) && (
                    <option value={roleId}>{member.role.name} · فعلی</option>
                  )}
                  {assignableRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              {assignableRoles.length === 0 && (
                <p className={styles.warning}>نقش قابل تخصیص در این محدوده در دسترس نیست.</p>
              )}
              <label className={styles.field}>
                دلیل تغییر نقش
                <textarea
                  disabled={actionsDisabled}
                  maxLength={500}
                  minLength={8}
                  onChange={(event) => setRoleReason(event.currentTarget.value)}
                  required
                  rows={2}
                  value={roleReason}
                />
              </label>
              <Button
                disabled={
                  actionsDisabled ||
                  roleId === member.role.id ||
                  roleReason.trim().length < 8 ||
                  assignableRoles.length === 0
                }
                type="submit"
              >
                ثبت نقش جدید
              </Button>
            </form>

            <div className={styles.inlineForm}>
              <h3>وضعیت عضویت</h3>
              <p className={styles.explainer}>
                تعلیق، دسترسی بعدی را در سرور رد می‌کند. فعال‌سازی نیز دوباره از سیاست و scope عبور
                می‌کند.
              </p>
              <label className={styles.field}>
                دلیل تغییر وضعیت
                <textarea
                  disabled={actionsDisabled}
                  maxLength={500}
                  onChange={(event) => setStatusReason(event.currentTarget.value)}
                  rows={2}
                  value={statusReason}
                />
              </label>
              <div className={styles.buttonRow}>
                {member.status === 'active' ? (
                  <Button
                    disabled={actionsDisabled}
                    onClick={() => submitStatus('suspend')}
                    tone="danger"
                    type="button"
                  >
                    تعلیق عضویت
                  </Button>
                ) : (
                  <Button
                    disabled={actionsDisabled}
                    onClick={() => submitStatus('reactivate')}
                    type="button"
                  >
                    فعال‌سازی مجدد
                  </Button>
                )}
              </div>
            </div>

            <details className={styles.overridePanel}>
              <summary>استثناهای دسترسی این عضویت</summary>
              <p className={styles.explainer}>
                استثنا فقط به همین عضویت و محدوده‌ی انتخاب‌شده متصل است؛ رد دسترسی بر اعطا مقدم است.
                سرور اختیار واگذاری، دامنه و اصل حفظ آخرین مدیر را دوباره کنترل می‌کند.
              </p>
              {overrideLoadState === 'loading' && <p role="status">در حال دریافت استثناها…</p>}
              {overrideLoadState === 'error' && (
                <div>
                  <p className={styles.error} role="alert">
                    {overrideError}
                  </p>
                  <Button onClick={() => void refreshOverrides()} type="button" tone="ghost">
                    تلاش دوباره
                  </Button>
                </div>
              )}
              {overrideLoadState === 'loaded' && (
                <>
                  {overrides.length === 0 ? (
                    <p className={styles.empty}>برای این عضویت استثنایی ثبت نشده است.</p>
                  ) : (
                    <div className={styles.overrideList}>
                      {overrides.map((override) => (
                        <article className={styles.overrideCard} key={override.id}>
                          <div className={styles.overrideHeading}>
                            <bdi dir="ltr">{override.permissionKey}</bdi>
                            <span
                              className={
                                override.effect === 'deny' ? styles.denyTag : styles.allowTag
                              }
                            >
                              {override.effect === 'deny' ? 'رد' : 'اعطا'}
                            </span>
                          </div>
                          <p>
                            {override.revokedAt
                              ? `لغوشده در ${dateLabel(override.revokedAt)}`
                              : override.expiresAt
                                ? `انقضا: ${dateLabel(override.expiresAt)}`
                                : 'بدون زمان انقضا'}
                            {override.resource &&
                              ` · منبع ${override.resource.type}: ${override.resource.id}`}
                          </p>
                          {override.reason && <small>دلیل ثبت: {override.reason}</small>}
                          {!override.revokedAt && (
                            <div className={styles.revokeOverride}>
                              <label className={styles.field}>
                                دلیل لغو استثنا
                                <input
                                  disabled={actionsDisabled}
                                  maxLength={500}
                                  minLength={8}
                                  onChange={(event) =>
                                    setRevokeReasons((current) => ({
                                      ...current,
                                      [override.id]: event.currentTarget.value,
                                    }))
                                  }
                                  value={revokeReasons[override.id] ?? ''}
                                />
                              </label>
                              <Button
                                disabled={
                                  actionsDisabled ||
                                  (revokeReasons[override.id] ?? '').trim().length < 8
                                }
                                onClick={() => revokeOverride(override)}
                                tone="danger"
                                type="button"
                              >
                                لغو استثنا
                              </Button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}

                  <form className={styles.overrideForm} onSubmit={submitOverride}>
                    <h3>افزودن استثنای فردی</h3>
                    {delegablePermissions.length === 0 ? (
                      <p className={styles.warning}>
                        مجوز قابل واگذاری برای این محدوده وجود ندارد.
                      </p>
                    ) : (
                      <>
                        <label className={styles.field}>
                          مجوز کاتالوگ
                          <select
                            disabled={actionsDisabled}
                            onChange={(event) => setPermissionKey(event.currentTarget.value)}
                            required
                            value={permissionKey}
                          >
                            <option value="">انتخاب مجوز</option>
                            {delegablePermissions.map((permission) => (
                              <option key={permission.key} value={permission.key}>
                                {permission.key}
                                {permission.stepUp ? ' · نیازمند MFA تازه' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            اثر استثنا
                            <select
                              disabled={actionsDisabled}
                              onChange={(event) =>
                                setEffect(event.currentTarget.value as 'deny' | 'allow')
                              }
                              value={effect}
                            >
                              <option value="deny">رد مجوز · اولویت امنیتی</option>
                              <option value="allow">اعطای محدود</option>
                            </select>
                          </label>
                          <label className={styles.field}>
                            زمان انقضا (اختیاری)
                            <DateTimePickerField
                              disabled={actionsDisabled}
                              onChange={setExpiresAt}
                              value={expiresAt}
                              title="زمان انقضای دسترسی"
                            />
                          </label>
                        </div>
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            نوع منبع (اختیاری)
                            <input
                              disabled={actionsDisabled}
                              maxLength={80}
                              onChange={(event) => setResourceType(event.currentTarget.value)}
                              value={resourceType}
                            />
                          </label>
                          <label className={styles.field}>
                            شناسه‌ی منبع (اختیاری)
                            <input
                              disabled={actionsDisabled}
                              maxLength={160}
                              onChange={(event) => setResourceId(event.currentTarget.value)}
                              value={resourceId}
                            />
                          </label>
                        </div>
                        <label className={styles.field}>
                          دلیل استثنا
                          <textarea
                            disabled={actionsDisabled}
                            maxLength={500}
                            minLength={8}
                            onChange={(event) => setOverrideReason(event.currentTarget.value)}
                            required
                            rows={2}
                            value={overrideReason}
                          />
                        </label>
                        <Button
                          disabled={
                            actionsDisabled || !permissionKey || overrideReason.trim().length < 8
                          }
                          type="submit"
                        >
                          ثبت استثنا
                        </Button>
                      </>
                    )}
                  </form>
                  {overrideError && (
                    <p className={styles.error} role="alert">
                      {overrideError}
                    </p>
                  )}
                  {overrideNotice && (
                    <p className={styles.notice} role="status">
                      {overrideNotice}
                    </p>
                  )}
                </>
              )}
            </details>
          </div>
        </details>
      )}
    </Surface>
  );
}

function statusLabel(status: OperationsStaffMember['status']): string {
  const labels: Record<OperationsStaffMember['status'], string> = {
    pending: 'در انتظار پذیرش',
    active: 'فعال',
    suspended: 'معلق',
    revoked: 'لغوشده',
  };
  return labels[status];
}

function safeMemberName(member: OperationsStaffMember): string {
  const identityName =
    member.identity?.displayName?.trim() ||
    [member.identity?.firstName, member.identity?.lastName].filter(Boolean).join(' ').trim();
  return identityName || member.maskedPhone || 'کارمند · شماره پنهان';
}

function scopeLabel(scope: OperationsScope): string {
  return scope.type === 'branch' ? 'شعبه' : 'مجموعه';
}

function isRoleAssignableToMembership(
  roleScope: OperationsScope,
  membershipScope: OperationsScope,
): boolean {
  if (roleScope.organizationId !== membershipScope.organizationId) return false;
  if (roleScope.type === 'organization') return true;
  return membershipScope.type === 'branch' && roleScope.branchId === membershipScope.branchId;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'نامشخص' : date.toLocaleString('fa-IR');
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس دسترسی برقرار نشد.';
}
