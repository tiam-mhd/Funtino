'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  normalizeDigits,
  normalizePhone,
  scopeKey,
  type OperationsScope,
} from '../../lib/auth/operations-access';
import {
  confirmOperationsMfaEnrollment,
  freshIdempotencyKey,
  getOperationsMfaStatus,
  inviteOperationsStaff,
  listOperationsPermissions,
  listOperationsRoles,
  listOperationsStaff,
  listScopedStaffInvitations,
  revokeScopedStaffInvitation,
  startOperationsMfaEnrollment,
  verifyOperationsMfaStepUp,
  type OperationsAccessRole,
  type OperationsMfaEnrollment,
  type OperationsMfaRecoveryCodes,
  type OperationsMfaStatus,
  type OperationsPage,
  type OperationsPermission,
  type OperationsStaffInvitation,
  type OperationsStaffMember,
} from '../../lib/api/operations-staff';
import { StaffMemberCard } from './StaffMemberCard';
import styles from './StaffAccessManager.module.css';

type StaffAccessManagerProps = {
  scope: OperationsScope;
  onSessionExpired: () => void;
};

type PendingMutation = { label: string; run: () => Promise<void> };
type MfaStage = 'verify' | 'start-enrollment' | 'confirm-enrollment' | 'save-recovery';
type RosterFilter = 'all' | OperationsStaffMember['status'];

export function StaffAccessManager({ scope, onSessionExpired }: StaffAccessManagerProps) {
  const [staff, setStaff] = useState<OperationsStaffMember[]>([]);
  const [staffCursor, setStaffCursor] = useState<string | null>(null);
  const [roles, setRoles] = useState<OperationsAccessRole[]>([]);
  const [rolesCursor, setRolesCursor] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<OperationsStaffInvitation[]>([]);
  const [invitationsCursor, setInvitationsCursor] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<OperationsPermission[]>([]);
  const [mfaStatus, setMfaStatus] = useState<OperationsMfaStatus | null>(null);
  const [mfaStatusError, setMfaStatusError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadMoreBusy, setLoadMoreBusy] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'roster' | 'invitations'>('roster');
  const [search, setSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const [sortBy, setSortBy] = useState<'member' | 'role'>('member');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteReason, setInviteReason] = useState('');
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [mfaStage, setMfaStage] = useState<MfaStage | null>(null);
  const [mfaError, setMfaError] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaCheckBusy, setMfaCheckBusy] = useState(false);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'recovery'>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [enrollment, setEnrollment] = useState<OperationsMfaEnrollment | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<OperationsMfaRecoveryCodes | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const stepUpUntil = useRef(0);
  const inviteRetry = useRef<{ fingerprint: string; key: string } | null>(null);

  const currentScopeKey = scopeKey(scope);

  const loadData = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setLoadError('');
      const results = await Promise.allSettled([
        listOperationsStaff(scope),
        listScopedStaffInvitations(scope),
        listOperationsRoles(scope),
        listOperationsPermissions(),
        getOperationsMfaStatus(),
      ]);
      const [staffResult, invitationsResult, rolesResult, permissionsResult, mfaResult] = results;
      const required = [staffResult, invitationsResult, rolesResult, permissionsResult];
      const unauthorized = results.find(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof ApiRequestError &&
          result.reason.status === 401,
      );
      if (unauthorized?.status === 'rejected') {
        onSessionExpired();
        setLoading(false);
        return;
      }

      const failedRequired = required.find((result) => result.status === 'rejected');
      if (failedRequired?.status === 'rejected') {
        setLoadError(messageFor(failedRequired.reason));
      } else {
        const staffPage = (
          staffResult as PromiseFulfilledResult<OperationsPage<OperationsStaffMember>>
        ).value;
        const invitationPage = (
          invitationsResult as PromiseFulfilledResult<OperationsPage<OperationsStaffInvitation>>
        ).value;
        const rolePage = (
          rolesResult as PromiseFulfilledResult<{
            data: OperationsAccessRole[];
            nextCursor: string | null;
          }>
        ).value;
        const permissionList = (permissionsResult as PromiseFulfilledResult<OperationsPermission[]>)
          .value;
        setStaff(staffPage.data);
        setStaffCursor(staffPage.nextCursor);
        setInvitations(invitationPage.data);
        setInvitationsCursor(invitationPage.nextCursor);
        setRoles(rolePage.data);
        setRolesCursor(rolePage.nextCursor);
        setPermissions(permissionList);
      }

      if (mfaResult.status === 'fulfilled') {
        setMfaStatus(mfaResult.value);
        setMfaStatusError('');
      } else {
        setMfaStatus(null);
        setMfaStatusError(messageFor(mfaResult.reason));
      }
      setLoading(false);
    },
    [onSessionExpired, scope],
  );

  useEffect(() => {
    setStaff([]);
    setStaffCursor(null);
    setRoles([]);
    setRolesCursor(null);
    setInvitations([]);
    setInvitationsCursor(null);
    setPermissions([]);
    setLoadError('');
    setActionError('');
    setNotice('');
    setTab('roster');
    setLoading(true);
    void loadData();
  }, [currentScopeKey, loadData]);

  const performMutation = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setActionBusy(true);
      setActionError('');
      setNotice('');
      try {
        await action();
        setNotice(label);
        await loadData(false);
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) {
          onSessionExpired();
        } else {
          if (failure instanceof ApiRequestError && failure.status === 403) stepUpUntil.current = 0;
          if (
            failure instanceof ApiRequestError &&
            (failure.status === 409 || failure.status === 412)
          ) {
            await loadData(false);
          }
          setActionError(messageFor(failure));
        }
      } finally {
        setActionBusy(false);
      }
    },
    [loadData, onSessionExpired],
  );

  const requestSensitiveAction = useCallback(
    async (label: string, run: () => Promise<void>, requiresStepUp = true) => {
      setActionError('');
      setNotice('');
      if (!requiresStepUp) {
        await performMutation(label, run);
        return;
      }
      setMfaCheckBusy(true);
      try {
        let currentStatus = mfaStatus;
        if (!currentStatus) {
          try {
            currentStatus = await getOperationsMfaStatus();
            setMfaStatus(currentStatus);
            setMfaStatusError('');
          } catch (failure) {
            if (failure instanceof ApiRequestError && failure.status === 401) {
              onSessionExpired();
            } else {
              setMfaStatusError(messageFor(failure));
            }
            return;
          }
        }

        if (currentStatus.enabled && stepUpUntil.current > Date.now() + 5_000) {
          await performMutation(label, run);
          return;
        }
        setPendingMutation({ label, run });
        setMfaError('');
        setMfaStage(currentStatus.enabled ? 'verify' : 'start-enrollment');
      } finally {
        setMfaCheckBusy(false);
      }
    },
    [mfaStatus, onSessionExpired, performMutation],
  );

  const filteredStaff = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return staff
      .filter((member) => rosterFilter === 'all' || member.status === rosterFilter)
      .filter(
        (member) =>
          !normalizedSearch ||
          `${safeMemberName(member)} ${member.maskedPhone ?? ''} ${member.role.name}`
            .toLocaleLowerCase()
            .includes(normalizedSearch),
      )
      .sort((left, right) => {
        const first =
          sortBy === 'role'
            ? left.role.name.localeCompare(right.role.name, 'fa')
            : safeMemberName(left).localeCompare(safeMemberName(right), 'fa');
        return first || left.membershipId.localeCompare(right.membershipId);
      });
  }, [rosterFilter, search, sortBy, staff]);

  const assignableRoles = roles.filter((role) => role.status === 'active' && !role.systemManaged);
  const actionsDisabled =
    actionBusy || mfaCheckBusy || mfaStage !== null || pendingMutation !== null;

  function inviteKey(fingerprint: string): string {
    if (inviteRetry.current?.fingerprint === fingerprint) return inviteRetry.current.key;
    const key = freshIdempotencyKey();
    inviteRetry.current = { fingerprint, key };
    return key;
  }

  function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(invitePhone);
    const reason = inviteReason.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone) || !inviteRoleId) {
      setActionError('شماره‌ی E.164 معتبر و نقش فعال انتخاب کنید.');
      return;
    }
    const input = {
      phoneE164: normalizedPhone,
      scope,
      roleId: inviteRoleId,
      ...(reason ? { reason } : {}),
    };
    const key = inviteKey(JSON.stringify(input));
    void requestSensitiveAction(
      'دعوت ثبت شد؛ فعال‌سازی فقط پس از پذیرش صریح با شماره‌ی تأییدشده انجام می‌شود.',
      async () => {
        await inviteOperationsStaff(input, key);
        inviteRetry.current = null;
        setInvitePhone('');
        setInviteRoleId('');
        setInviteReason('');
        setTab('invitations');
      },
      false,
    );
  }

  async function loadMore(kind: 'staff' | 'roles' | 'invitations') {
    const cursor =
      kind === 'staff' ? staffCursor : kind === 'roles' ? rolesCursor : invitationsCursor;
    if (!cursor || loadMoreBusy) return;
    setLoadMoreBusy(kind);
    setLoadError('');
    try {
      if (kind === 'staff') {
        const page = await listOperationsStaff(scope, cursor);
        setStaff((current) => mergeById(current, page.data, (item) => item.membershipId));
        setStaffCursor(page.nextCursor);
      } else if (kind === 'roles') {
        const page = await listOperationsRoles(scope, cursor);
        setRoles((current) => mergeById(current, page.data, (item) => item.id));
        setRolesCursor(page.nextCursor);
      } else {
        const page = await listScopedStaffInvitations(scope, cursor);
        setInvitations((current) => mergeById(current, page.data, (item) => item.id));
        setInvitationsCursor(page.nextCursor);
      }
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setLoadError(messageFor(failure));
    } finally {
      setLoadMoreBusy('');
    }
  }

  async function startEnrollment() {
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await startOperationsMfaEnrollment();
      setEnrollment(result);
      setEnrollmentCode('');
      setMfaStage('confirm-enrollment');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeDigits(enrollmentCode).replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) {
      setMfaError('کد برنامه‌ی رمزساز باید ۶ رقم باشد.');
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await confirmOperationsMfaEnrollment(code);
      setRecoveryCodes(result);
      setCodesSaved(false);
      stepUpUntil.current = Date.parse(result.validUntil);
      setMfaStatus({
        enabled: true,
        enrollmentPending: false,
        recoveryCodesRemaining: result.recoveryCodes.length,
      });
      setEnrollment(null);
      setEnrollmentCode('');
      setMfaStage('save-recovery');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code =
      mfaMethod === 'totp'
        ? normalizeDigits(mfaCode).replace(/\D/g, '')
        : normalizeDigits(mfaCode).trim().toUpperCase();
    if (
      mfaMethod === 'totp' ? !/^\d{6}$/.test(code) : !/^[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/.test(code)
    ) {
      setMfaError(
        mfaMethod === 'totp'
          ? 'کد برنامه‌ی رمزساز باید ۶ رقم باشد.'
          : 'قالب کد بازیابی معتبر نیست.',
      );
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await verifyOperationsMfaStepUp({ method: mfaMethod, code });
      stepUpUntil.current = Date.parse(result.validUntil);
      setMfaCode('');
      setMfaStatus((current) => (current ? { ...current, enabled: true } : current));
      const next = pendingMutation;
      setPendingMutation(null);
      setMfaStage(null);
      if (next) await performMutation(next.label, next.run);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function continueAfterRecoveryCodes() {
    if (!codesSaved || !pendingMutation) return;
    const next = pendingMutation;
    setRecoveryCodes(null);
    setPendingMutation(null);
    setMfaStage(null);
    setMfaError('');
    await performMutation(next.label, next.run);
  }

  function cancelMfa() {
    setPendingMutation(null);
    setMfaStage(null);
    setMfaError('');
    setMfaCode('');
    setEnrollment(null);
    setEnrollmentCode('');
    setRecoveryCodes(null);
    setCodesSaved(false);
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.recoveryCodes.join('\n'));
    } catch {
      setMfaError('کپی در دسترس نیست؛ کدها را پیش از ادامه در محل امن ذخیره کنید.');
    }
  }

  function revokeInvitation(invitation: OperationsStaffInvitation, reason: string, key: string) {
    void requestSensitiveAction(
      'دعوت لغو شد و دیگر قابل پذیرش نیست.',
      async () => {
        await revokeScopedStaffInvitation(invitation.id, reason || undefined, key);
      },
      false,
    );
  }

  return (
    <section className={styles.manager} aria-labelledby="staff-access-title">
      <header className={styles.managerHeader}>
        <div>
          <p className={styles.eyebrow}>مدیریت محدوده‌ی فعال</p>
          <h2 id="staff-access-title">کارکنان و دسترسی‌ها</h2>
          <p className={styles.explainer}>
            عضویت‌ها، دعوت‌ها و استثناها از IAM خوانده می‌شوند. هر درخواست دوباره در سرور و در همین
            محدوده مجوزسنجی می‌شود.
          </p>
        </div>
        <div className={styles.managerActions}>
          {mfaStatus ? (
            <Badge tone={mfaStatus.enabled ? 'success' : 'warning'}>
              MFA {mfaStatus.enabled ? 'فعال' : 'نیازمند راه‌اندازی'}
            </Badge>
          ) : (
            <Badge tone="neutral">MFA بررسی‌نشده</Badge>
          )}
          <Button disabled={loading} onClick={() => void loadData()} tone="ghost" type="button">
            {loading ? 'در حال دریافت…' : 'به‌روزرسانی'}
          </Button>
        </div>
      </header>

      {mfaStatusError && !mfaStatus && (
        <p className={styles.warning} role="status">
          وضعیت MFA دریافت نشد؛ تغییر حساس تا تأیید وضعیت متوقف می‌ماند. {mfaStatusError}
        </p>
      )}
      {loadError && (
        <div className={styles.errorBlock}>
          <p className={styles.error} role="alert">
            {loadError}
          </p>
          <Button disabled={loading} onClick={() => void loadData()} type="button" tone="ghost">
            تلاش دوباره
          </Button>
        </div>
      )}
      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {mfaStage && (
        <Surface className={styles.mfaPanel} aria-labelledby="staff-mfa-panel-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>تأیید نشست مدیریتی</p>
              <h3 id="staff-mfa-panel-title">{pendingMutation?.label ?? 'تأیید دومرحله‌ای'}</h3>
            </div>
            <Button
              disabled={mfaBusy || (mfaStage === 'save-recovery' && !codesSaved)}
              onClick={cancelMfa}
              tone="ghost"
              type="button"
            >
              انصراف
            </Button>
          </div>
          <p className={styles.explainer}>
            ورود پیامکی جایگزین MFA نیست. اثبات این مرحله فقط در نشست سمت‌سرور ثبت می‌شود و حداکثر ۵
            دقیقه اعتبار دارد.
          </p>
          {mfaError && (
            <p className={styles.error} role="alert">
              {mfaError}
            </p>
          )}

          {mfaStage === 'verify' && (
            <form className={styles.form} onSubmit={(event) => void verifyStepUp(event)}>
              <label className={styles.field}>
                روش تأیید
                <select
                  disabled={mfaBusy}
                  onChange={(event) =>
                    setMfaMethod(event.currentTarget.value as 'totp' | 'recovery')
                  }
                  value={mfaMethod}
                >
                  <option value="totp">کد برنامه‌ی رمزساز</option>
                  <option value="recovery">کد بازیابی یک‌بارمصرف</option>
                </select>
              </label>
              <label className={styles.field}>
                {mfaMethod === 'totp' ? 'کد ۶ رقمی' : 'کد بازیابی'}
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  disabled={mfaBusy}
                  inputMode={mfaMethod === 'totp' ? 'numeric' : 'text'}
                  maxLength={mfaMethod === 'totp' ? 6 : 35}
                  onChange={(event) => setMfaCode(event.currentTarget.value)}
                  required
                  value={mfaCode}
                />
              </label>
              <Button disabled={mfaBusy} type="submit">
                {mfaBusy ? 'در حال تأیید…' : 'تأیید و ادامه‌ی عملیات'}
              </Button>
            </form>
          )}

          {mfaStage === 'start-enrollment' && (
            <div className={styles.form}>
              <p className={styles.explainer}>
                برای انجام این تغییر حساس، ابتدا یک برنامه‌ی رمزساز را متصل کنید. کلید فقط در همین
                نشست نمایش داده می‌شود.
              </p>
              <Button disabled={mfaBusy} onClick={() => void startEnrollment()} type="button">
                {mfaBusy
                  ? 'در حال آماده‌سازی…'
                  : mfaStatus?.enrollmentPending
                    ? 'ادامه‌ی راه‌اندازی MFA'
                    : 'راه‌اندازی MFA'}
              </Button>
            </div>
          )}

          {mfaStage === 'confirm-enrollment' && enrollment && (
            <form className={styles.form} onSubmit={(event) => void confirmEnrollment(event)}>
              <p className={styles.explainer}>
                کلید را در برنامه‌ی رمزساز وارد کنید؛ سپس کد شش‌رقمی همان برنامه را برای تأیید
                بنویسید. این کلید را با کسی به اشتراک نگذارید.
              </p>
              <code className={styles.secretCode} dir="ltr">
                {enrollment.secret}
              </code>
              <p className={styles.mfaExpiry}>
                مهلت راه‌اندازی: {new Date(enrollment.expiresAt).toLocaleString('fa-IR')}
              </p>
              <label className={styles.field}>
                کد برنامه‌ی رمزساز
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  disabled={mfaBusy}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setEnrollmentCode(event.currentTarget.value)}
                  required
                  value={enrollmentCode}
                />
              </label>
              <Button disabled={mfaBusy} type="submit">
                {mfaBusy ? 'در حال فعال‌سازی…' : 'فعال‌سازی و دریافت کدهای بازیابی'}
              </Button>
            </form>
          )}

          {mfaStage === 'save-recovery' && recoveryCodes && (
            <div className={styles.form}>
              <p className={styles.warning} role="status">
                MFA فعال شد. این ۱۰ کد بازیابی فقط یک‌بار نمایش داده می‌شوند؛ پیش از ادامه آن‌ها را
                در محل امن ذخیره کنید.
              </p>
              <ol className={styles.recoveryCodes} dir="ltr">
                {recoveryCodes.recoveryCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ol>
              <Button onClick={() => void copyRecoveryCodes()} tone="secondary" type="button">
                کپی کدهای بازیابی
              </Button>
              <label className={styles.checkField}>
                <input
                  checked={codesSaved}
                  onChange={(event) => setCodesSaved(event.currentTarget.checked)}
                  type="checkbox"
                />
                کدها را در محل امن ذخیره کردم.
              </label>
              <Button
                disabled={!codesSaved || mfaBusy}
                onClick={() => void continueAfterRecoveryCodes()}
                type="button"
              >
                ادامه و اجرای عملیات حساس
              </Button>
            </div>
          )}
        </Surface>
      )}

      {!loadError && (
        <>
          <div className={styles.tabs} role="group" aria-label="بخش مدیریت کارکنان">
            <Button
              aria-pressed={tab === 'roster'}
              onClick={() => setTab('roster')}
              type="button"
              tone={tab === 'roster' ? 'primary' : 'ghost'}
            >
              فهرست کارکنان و دعوت
            </Button>
            <Button
              aria-pressed={tab === 'invitations'}
              onClick={() => setTab('invitations')}
              type="button"
              tone={tab === 'invitations' ? 'primary' : 'ghost'}
            >
              دعوت‌های صادرشده ({invitations.length} دریافت‌شده)
            </Button>
          </div>

          {loading ? (
            <Surface className={styles.loadingState} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              در حال دریافت roster، نقش‌ها و دعوت‌های همین محدوده…
            </Surface>
          ) : tab === 'roster' ? (
            <div className={styles.rosterLayout}>
              <Surface className={styles.inviteFormPanel}>
                <p className={styles.eyebrow}>دعوت تازه · فقط شماره‌ی E.164</p>
                <h3>افزودن کارمند به محدوده</h3>
                <p className={styles.explainer}>
                  دعوت به همین مجموعه/شعبه فرستاده می‌شود؛ عضویت تا ورود با OTP همان شماره و پذیرش
                  صریح فعال نخواهد شد.
                </p>
                <form className={styles.form} onSubmit={submitInvitation}>
                  <label className={styles.field}>
                    شماره‌ی همراه (ایرانی یا E.164)
                    <input
                      autoComplete="tel"
                      dir="ltr"
                      disabled={actionsDisabled}
                      inputMode="tel"
                      onChange={(event) => setInvitePhone(event.currentTarget.value)}
                      placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                      required
                      type="tel"
                      value={invitePhone}
                    />
                  </label>
                  <label className={styles.field}>
                    نقش فعال و قابل واگذاری
                    <select
                      disabled={actionsDisabled || assignableRoles.length === 0}
                      onChange={(event) => setInviteRoleId(event.currentTarget.value)}
                      required
                      value={inviteRoleId}
                    >
                      <option value="">انتخاب نقش</option>
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {assignableRoles.length === 0 && (
                    <p className={styles.warning}>
                      نقش سفارشی فعال و قابل واگذاری در این محدوده پیدا نشد. نقش‌های سیستمی از این
                      فرم تخصیص داده نمی‌شوند.
                    </p>
                  )}
                  {rolesCursor && (
                    <Button
                      disabled={Boolean(loadMoreBusy)}
                      onClick={() => void loadMore('roles')}
                      tone="ghost"
                      type="button"
                    >
                      {loadMoreBusy === 'roles'
                        ? 'در حال دریافت نقش‌ها…'
                        : 'بارگذاری نقش‌های بیشتر'}
                    </Button>
                  )}
                  <label className={styles.field}>
                    دلیل دعوت
                    <textarea
                      disabled={actionsDisabled}
                      maxLength={500}
                      onChange={(event) => setInviteReason(event.currentTarget.value)}
                      rows={3}
                      value={inviteReason}
                    />
                  </label>
                  <Button disabled={actionsDisabled || assignableRoles.length === 0} type="submit">
                    صدور دعوت‌نامه
                  </Button>
                </form>
              </Surface>

              <section className={styles.rosterSection} aria-labelledby="roster-heading">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>فهرست مبتنی بر عضویت‌های IAM</p>
                    <h3 id="roster-heading">کارکنان · {staff.length} مورد دریافت‌شده</h3>
                  </div>
                </div>
                <div className={styles.filters}>
                  <label className={styles.field}>
                    جست‌وجو در شماره‌ی پوشیده یا نقش‌های دریافت‌شده
                    <input
                      onChange={(event) => setSearch(event.currentTarget.value)}
                      value={search}
                    />
                  </label>
                  <label className={styles.field}>
                    وضعیت
                    <select
                      onChange={(event) =>
                        setRosterFilter(event.currentTarget.value as RosterFilter)
                      }
                      value={rosterFilter}
                    >
                      <option value="all">همه</option>
                      <option value="active">فعال</option>
                      <option value="pending">در انتظار پذیرش</option>
                      <option value="suspended">معلق</option>
                      <option value="revoked">لغوشده</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    مرتب‌سازی
                    <select
                      onChange={(event) =>
                        setSortBy(event.currentTarget.value as 'member' | 'role')
                      }
                      value={sortBy}
                    >
                      <option value="member">شماره / شناسه</option>
                      <option value="role">نام نقش</option>
                    </select>
                  </label>
                </div>
                <p className={styles.explainer}>
                  جست‌وجو، فیلتر و مرتب‌سازی روی موارد دریافت‌شده اعمال می‌شود؛ برای بررسی فهرست
                  کامل، صفحه‌های بعدی را هم بارگذاری کنید.
                </p>
                {filteredStaff.length === 0 ? (
                  <Surface className={styles.emptyState}>
                    {staff.length === 0
                      ? 'در این محدوده عضوی ثبت نشده است.'
                      : 'در موارد دریافت‌شده نتیجه‌ای پیدا نشد؛ برای بررسی ادامه‌ی فهرست صفحه‌های بعدی را بارگذاری کنید.'}
                  </Surface>
                ) : (
                  <div className={styles.memberList}>
                    {filteredStaff.map((member) => (
                      <StaffMemberCard
                        actionsDisabled={actionsDisabled}
                        key={member.membershipId}
                        member={member}
                        onSensitiveAction={(label, action, requiresStepUp) =>
                          void requestSensitiveAction(label, action, requiresStepUp)
                        }
                        onSessionExpired={onSessionExpired}
                        permissions={permissions}
                        roles={roles}
                        scope={scope}
                      />
                    ))}
                  </div>
                )}
                {staffCursor && (
                  <Button
                    className={styles.loadMore}
                    disabled={Boolean(loadMoreBusy)}
                    onClick={() => void loadMore('staff')}
                    type="button"
                    tone="ghost"
                  >
                    {loadMoreBusy === 'staff' ? 'در حال دریافت…' : 'نمایش کارکنان بیشتر'}
                  </Button>
                )}
              </section>
            </div>
          ) : (
            <section
              className={styles.scopedInvitations}
              aria-labelledby="issued-invitations-heading"
            >
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>شماره‌ها به‌شکل پوشیده نمایش داده می‌شوند</p>
                  <h3 id="issued-invitations-heading">
                    دعوت‌های صادرشده · {invitations.length} مورد دریافت‌شده
                  </h3>
                </div>
              </div>
              {invitations.length === 0 ? (
                <Surface className={styles.emptyState}>
                  دعوتی برای این محدوده در دسترس نیست.
                </Surface>
              ) : (
                <div className={styles.memberList}>
                  {invitations.map((invitation) => (
                    <ScopedInvitationCard
                      actionsDisabled={actionsDisabled}
                      invitation={invitation}
                      key={invitation.id}
                      onRevoke={revokeInvitation}
                    />
                  ))}
                </div>
              )}
              {invitationsCursor && (
                <Button
                  className={styles.loadMore}
                  disabled={Boolean(loadMoreBusy)}
                  onClick={() => void loadMore('invitations')}
                  type="button"
                  tone="ghost"
                >
                  {loadMoreBusy === 'invitations' ? 'در حال دریافت…' : 'نمایش دعوت‌های بیشتر'}
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function ScopedInvitationCard({
  invitation,
  actionsDisabled,
  onRevoke,
}: {
  invitation: OperationsStaffInvitation;
  actionsDisabled: boolean;
  onRevoke: (invitation: OperationsStaffInvitation, reason: string, key: string) => void;
}) {
  const [reason, setReason] = useState('');
  const retryKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const expired = invitation.isExpired || Date.parse(invitation.expiresAt) <= Date.now();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (expired) return;
    const fingerprint = JSON.stringify({ invitationId: invitation.id, reason: cleanReason });
    if (retryKey.current?.fingerprint !== fingerprint) {
      retryKey.current = { fingerprint, key: freshIdempotencyKey() };
    }
    const key = retryKey.current.key;
    onRevoke(invitation, cleanReason, key);
  }

  return (
    <Surface className={styles.invitationCard}>
      <div className={styles.invitationHeading}>
        <div>
          <strong>{invitation.maskedPhone}</strong>
          <span>
            {invitation.role.name} · مقصد در سطح{' '}
            {invitation.scope.type === 'branch' ? 'شعبه' : 'مجموعه'}
          </span>
        </div>
        <span
          className={`${styles.statusBadge} ${expired || invitation.roleChanged ? styles.status_suspended : styles.status_pending}`}
        >
          {expired ? 'منقضی‌شده' : invitation.roleChanged ? 'نیازمند دعوت تازه' : 'در انتظار پذیرش'}
        </span>
      </div>
      <time dateTime={invitation.expiresAt}>
        اعتبار تا {new Date(invitation.expiresAt).toLocaleString('fa-IR')}
      </time>
      {invitation.roleChanged && (
        <p className={styles.warning}>نقش پس از صدور تغییر کرده است؛ این دعوت قابل پذیرش نیست.</p>
      )}
      {!expired && (
        <details className={styles.revokeInvitation}>
          <summary>لغو دعوت</summary>
          <form className={styles.inlineForm} onSubmit={submit}>
            <label className={styles.field}>
              دلیل لغو
              <textarea
                disabled={actionsDisabled}
                maxLength={500}
                onChange={(event) => setReason(event.currentTarget.value)}
                rows={2}
                value={reason}
              />
            </label>
            <Button disabled={actionsDisabled} tone="danger" type="submit">
              لغو دعوت‌نامه
            </Button>
          </form>
        </details>
      )}
    </Surface>
  );
}

function mergeById<T>(existing: T[], incoming: T[], idOf: (item: T) => string): T[] {
  const items = new Map(existing.map((item) => [idOf(item), item]));
  for (const item of incoming) items.set(idOf(item), item);
  return [...items.values()];
}

function safeMemberName(member: OperationsStaffMember): string {
  const identityName =
    member.identity?.displayName?.trim() ||
    [member.identity?.firstName, member.identity?.lastName].filter(Boolean).join(' ').trim();
  return identityName || member.maskedPhone || 'کارمند · شماره پنهان';
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس مدیریت کارکنان برقرار نشد.';
}
