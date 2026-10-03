'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  normalizeDigits,
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import {
  confirmOperationsMfaEnrollment,
  getOperationsMfaStatus,
  startOperationsMfaEnrollment,
  verifyOperationsMfaStepUp,
  type OperationsMfaEnrollment,
  type OperationsMfaRecoveryCodes,
  type OperationsMfaStatus,
} from '../../lib/api/operations-staff';
import {
  listOperationsDeviceBranches,
  listOperationsDevices,
  registerOperationsDevice,
  updateOperationsDevice,
  type OperationsDevice,
  type OperationsDeviceBranch,
  type OperationsDeviceCapabilities,
} from '../../lib/api/operations-devices';
import styles from './DeviceManagement.module.css';

type Props = {
  scope: OperationsScope;
  scopeOption: OperationsScopeOption;
  onSessionExpired: () => void;
  mfaStepUpUntil: number | null;
  onMfaStepUp: (validUntil: number) => void;
};
type HealthFilter = 'all' | OperationsDevice['healthState'];
type DeviceTypeFilter = 'all' | OperationsDevice['deviceType'];
type StatusFilter = 'all' | OperationsDevice['status'];
type MfaStage = 'verify' | 'start-enrollment' | 'confirm-enrollment' | 'save-recovery';
type DeviceDraft = {
  displayName: string;
  status: '' | OperationsDevice['status'];
  reason: string;
  confirmRetirement: boolean;
};
type RegistrationDraft = {
  branchId: string;
  adapterKey: string;
  externalDeviceId: string;
  displayName: string;
  deviceType: OperationsDevice['deviceType'];
  reason: string;
};

const emptyCapabilities: OperationsDeviceCapabilities = {
  canRegister: false,
  canManage: false,
  canReadBranches: false,
};
const healthLabels: Record<OperationsDevice['healthState'], string> = {
  unknown: 'بدون مشاهده معتبر',
  online: 'آنلاین',
  degraded: 'دارای اختلال',
  stale: 'داده کهنه',
  offline: 'آفلاین',
};
const healthTones: Record<
  OperationsDevice['healthState'],
  'neutral' | 'success' | 'warning' | 'danger'
> = {
  unknown: 'neutral',
  online: 'success',
  degraded: 'warning',
  stale: 'warning',
  offline: 'danger',
};
const lifecycleLabels: Record<OperationsDevice['status'], string> = {
  active: 'فعال',
  suspended: 'تعلیق‌شده',
  retired: 'بازنشسته',
};
const typeLabels: Record<OperationsDevice['deviceType'], string> = {
  rfid_reader: 'کارت‌خوان RFID',
  terminal: 'پایانه',
  access_gate: 'گیت دسترسی',
  other: 'سایر',
};

export function DeviceManagement({
  scope,
  scopeOption,
  onSessionExpired,
  mfaStepUpUntil,
  onMfaStepUp,
}: Props) {
  const currentScopeKey = scopeKey(scope);
  const [devices, setDevices] = useState<OperationsDevice[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState(emptyCapabilities);
  const [branches, setBranches] = useState<OperationsDeviceBranch[]>([]);
  const [branchCursor, setBranchCursor] = useState<string | null>(null);
  const [branchesError, setBranchesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [typeFilter, setTypeFilter] = useState<DeviceTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationDraft, setRegistrationDraft] = useState<RegistrationDraft>({
    branchId: scope.type === 'branch' ? scope.branchId : '',
    adapterKey: 'manual',
    externalDeviceId: '',
    displayName: '',
    deviceType: 'rfid_reader',
    reason: '',
  });
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<DeviceDraft>({
    displayName: '',
    status: '',
    reason: '',
    confirmRetirement: false,
  });
  const [mfaStatus, setMfaStatus] = useState<OperationsMfaStatus | null>(null);
  const [mfaStage, setMfaStage] = useState<MfaStage | null>(null);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'recovery'>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<OperationsMfaEnrollment | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<OperationsMfaRecoveryCodes | null>(null);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const scopeRef = useRef(scope);
  const scopeOptionRef = useRef(scopeOption);
  const statusFilterRef = useRef(statusFilter);
  const previousStatusFilter = useRef(statusFilter);
  scopeRef.current = scope;
  scopeOptionRef.current = scopeOption;
  statusFilterRef.current = statusFilter;
  const requestVersion = useRef(0);
  const pagesLoaded = useRef(1);
  const listBusy = useRef(false);
  const branchBusy = useRef(false);
  const lastRegistrationAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const lastUpdateAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadBranchPage = useCallback(
    async (cursor?: string) => {
      if (scope.type !== 'organization' || branchBusy.current) return;
      branchBusy.current = true;
      setLoadingBranches(true);
      setBranchesError('');
      try {
        const page = await listOperationsDeviceBranches(scope.organizationId, cursor);
        setBranches((current) => (cursor ? appendUnique(current, page.data) : page.data));
        setBranchCursor(page.nextCursor);
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        else setBranchesError(messageFor(failure));
      } finally {
        branchBusy.current = false;
        setLoadingBranches(false);
      }
    },
    [onSessionExpired, scope.organizationId, scope.type],
  );

  const refresh = useCallback(
    async (quiet = false) => {
      const requestId = ++requestVersion.current;
      listBusy.current = true;
      if (!quiet) setLoading(true);
      setLoadError('');
      setActionError('');
      try {
        const targetPages = quiet ? pagesLoaded.current : 1;
        const activeScope = scopeRef.current;
        const activeOption = scopeOptionRef.current;
        const currentStatus = statusFilterRef.current;
        const firstPage = await listOperationsDevices(
          activeScope,
          undefined,
          currentStatus === 'all' ? undefined : currentStatus,
        );
        const refreshedDevices = [...firstPage.data];
        let cursor = firstPage.nextCursor;
        let pagesFetched = 1;
        while (cursor && pagesFetched < targetPages) {
          const page = await listOperationsDevices(
            activeScope,
            cursor,
            currentStatus === 'all' ? undefined : currentStatus,
          );
          refreshedDevices.push(...page.data);
          cursor = page.nextCursor;
          pagesFetched += 1;
        }
        if (requestId !== requestVersion.current) return;
        setDevices(dedupeDevices(refreshedDevices));
        setNextCursor(cursor);
        pagesLoaded.current = pagesFetched;
        setCapabilities(firstPage.capabilities);
        setLastUpdatedAt(Date.now());
        if (activeScope.type === 'organization' && firstPage.capabilities.canReadBranches) {
          void loadBranchPage();
        } else if (activeScope.type === 'organization') {
          setBranches([]);
          setBranchCursor(null);
          setBranchesError('برای مشاهده فهرست شعب، مجوز branch.read لازم است.');
        } else {
          setBranches([
            {
              id: activeScope.branchId,
              organizationId: activeScope.organizationId,
              name: activeOption.branch?.name ?? 'شعبه انتخاب‌شده',
              city: activeOption.branch?.city ?? '',
            },
          ]);
        }
      } catch (failure) {
        if (requestId !== requestVersion.current) return;
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        else setLoadError(messageFor(failure));
      } finally {
        if (requestId === requestVersion.current) {
          listBusy.current = false;
          setLoading(false);
        }
      }
    },
    [loadBranchPage, onSessionExpired],
  );

  useEffect(() => {
    const activeScope = scopeRef.current;
    const activeOption = scopeOptionRef.current;
    requestVersion.current += 1;
    pagesLoaded.current = 1;
    setDevices([]);
    setNextCursor(null);
    setCapabilities(emptyCapabilities);
    setBranches(
      activeScope.type === 'branch'
        ? [
            {
              id: activeScope.branchId,
              organizationId: activeScope.organizationId,
              name: activeOption.branch?.name ?? 'شعبه انتخاب‌شده',
              city: activeOption.branch?.city ?? '',
            },
          ]
        : [],
    );
    setBranchCursor(null);
    setSearch('');
    setHealthFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setBranchFilter('all');
    setShowFollowUp(false);
    setRegistrationOpen(false);
    setMfaStatus(null);
    setMfaStage(null);
    setEnrollment(null);
    setRecoveryCodes(null);
    setRegistrationDraft({
      branchId: activeScope.type === 'branch' ? activeScope.branchId : '',
      adapterKey: 'manual',
      externalDeviceId: '',
      displayName: '',
      deviceType: 'rfid_reader',
      reason: '',
    });
    void refresh(false);
    return () => {
      requestVersion.current += 1;
    };
  }, [currentScopeKey, refresh]);

  useEffect(() => {
    if (previousStatusFilter.current === statusFilter) return;
    previousStatusFilter.current = statusFilter;
    pagesLoaded.current = 1;
    setDevices([]);
    setNextCursor(null);
    void refresh(false);
  }, [refresh, statusFilter]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        !listBusy.current &&
        !loadingMore &&
        pagesLoaded.current === 1
      )
        void refresh(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadingMore, refresh]);

  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const canRegister =
    capabilities.canRegister && (scope.type === 'branch' || capabilities.canReadBranches);
  const visibleDevices = useMemo(() => {
    const normalizedSearch = normalizeSearch(search);
    const matching = devices.filter((device) => {
      if (statusFilter !== 'all' && device.status !== statusFilter) return false;
      if (healthFilter !== 'all' && device.healthState !== healthFilter) return false;
      if (typeFilter !== 'all' && device.deviceType !== typeFilter) return false;
      if (branchFilter !== 'all' && device.branchId !== branchFilter) return false;
      if (showFollowUp && !['degraded', 'stale', 'offline'].includes(device.healthState))
        return false;
      if (normalizedSearch) {
        const branchName = branchNames.get(device.branchId) ?? '';
        const haystack = normalizeSearch(
          [device.displayName, device.adapterKey, device.externalDeviceId, branchName].join(' '),
        );
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
    if (!showFollowUp) return matching;
    return matching.sort(
      (left, right) =>
        healthPriority(left.healthState) - healthPriority(right.healthState) ||
        (right.freshnessSeconds ?? -1) - (left.freshnessSeconds ?? -1),
    );
  }, [
    branchFilter,
    branchNames,
    devices,
    healthFilter,
    search,
    showFollowUp,
    statusFilter,
    typeFilter,
  ]);

  const healthCounts = useMemo(
    () => ({
      attention: devices.filter((device) =>
        ['degraded', 'stale', 'offline'].includes(device.healthState),
      ).length,
      unknown: devices.filter((device) => device.healthState === 'unknown').length,
      online: devices.filter((device) => device.healthState === 'online').length,
    }),
    [devices],
  );

  async function loadMoreDevices() {
    if (!nextCursor || loadingMore) return;
    const cursor = nextCursor;
    const requestId = ++requestVersion.current;
    listBusy.current = true;
    setLoadingMore(true);
    setLoadError('');
    try {
      const page = await listOperationsDevices(
        scope,
        cursor,
        statusFilter === 'all' ? undefined : statusFilter,
      );
      if (requestId !== requestVersion.current) return;
      setDevices((current) => dedupeDevices([...current, ...page.data]));
      setNextCursor(page.nextCursor);
      pagesLoaded.current += 1;
      setCapabilities(page.capabilities);
      setLastUpdatedAt(Date.now());
    } catch (failure) {
      if (requestId !== requestVersion.current) return;
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setLoadError(messageFor(failure));
    } finally {
      if (requestId === requestVersion.current) {
        listBusy.current = false;
        setLoadingMore(false);
      }
    }
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities.canRegister || actionBusy) return;
    const branchId = scope.type === 'branch' ? scope.branchId : registrationDraft.branchId;
    if (!branchId) {
      setActionError('ابتدا شعبه‌ی مقصد را انتخاب کنید.');
      return;
    }
    const body = {
      adapterKey: registrationDraft.adapterKey.trim(),
      externalDeviceId: registrationDraft.externalDeviceId.trim(),
      displayName: registrationDraft.displayName.trim(),
      deviceType: registrationDraft.deviceType,
      reason: registrationDraft.reason.trim(),
    };
    const fingerprint = JSON.stringify([scope.organizationId, branchId, body]);
    const key =
      lastRegistrationAttempt.current?.fingerprint === fingerprint
        ? lastRegistrationAttempt.current.key
        : crypto.randomUUID();
    lastRegistrationAttempt.current = { fingerprint, key };
    setActionBusy(true);
    setActionError('');
    setNotice('');
    try {
      await registerOperationsDevice(scope.organizationId, branchId, body, key);
      lastRegistrationAttempt.current = null;
      setRegistrationDraft((current) => ({
        ...current,
        externalDeviceId: '',
        displayName: '',
        reason: '',
      }));
      setRegistrationOpen(false);
      setNotice('دستگاه ثبت شد؛ تا دریافت اولین مشاهده‌ی معتبر، سلامت آن ناشناخته باقی می‌ماند.');
      await refresh(true);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setActionError(messageFor(failure));
    } finally {
      setActionBusy(false);
    }
  }

  async function submitDeviceUpdate(event: FormEvent<HTMLFormElement>, device: OperationsDevice) {
    event.preventDefault();
    if (!capabilities.canManage || actionBusy) return;
    if (deviceDraft.status === 'retired' && !deviceDraft.confirmRetirement) {
      setActionError('برای بازنشستگی دائمی دستگاه، تأیید صریح را ثبت کنید.');
      return;
    }
    const body: { displayName?: string; status?: OperationsDevice['status']; reason: string } = {
      reason: deviceDraft.reason.trim(),
    };
    const nextName = deviceDraft.displayName.trim();
    if (nextName && nextName !== device.displayName) body.displayName = nextName;
    if (deviceDraft.status && deviceDraft.status !== device.status)
      body.status = deviceDraft.status;
    if (Object.keys(body).length === 1) {
      setActionError('حداقل یک تغییر نام یا وضعیت انتخاب کنید.');
      return;
    }
    const fingerprint = JSON.stringify([device.id, device.version, body]);
    const key =
      lastUpdateAttempt.current?.fingerprint === fingerprint
        ? lastUpdateAttempt.current.key
        : crypto.randomUUID();
    lastUpdateAttempt.current = { fingerprint, key };
    setActionBusy(true);
    setActionError('');
    setNotice('');
    try {
      await updateOperationsDevice(device, body, key);
      lastUpdateAttempt.current = null;
      setEditingDeviceId(null);
      setNotice('تغییرات دستگاه ثبت شد.');
      await refresh(true);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setActionError(messageFor(failure));
    } finally {
      setActionBusy(false);
    }
  }

  async function openMfaStepUp() {
    setMfaBusy(true);
    setMfaError('');
    try {
      const status = await getOperationsMfaStatus();
      setMfaStatus(status);
      setMfaStage(status.enabled ? 'verify' : 'start-enrollment');
      setMfaCode('');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function beginMfaEnrollment() {
    setMfaBusy(true);
    setMfaError('');
    try {
      const nextEnrollment = await startOperationsMfaEnrollment();
      setEnrollment(nextEnrollment);
      setEnrollmentCode('');
      setMfaStage('confirm-enrollment');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
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
      const proof = await verifyOperationsMfaStepUp({ method: mfaMethod, code });
      onMfaStepUp(Date.parse(proof.validUntil));
      setMfaCode('');
      setMfaStage(null);
      await refresh(true);
      setNotice('تأیید دومرحله‌ای این نشست انجام شد؛ مجوزهای عملیاتی دوباره از سرور خوانده شدند.');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmMfaEnrollment(event: FormEvent<HTMLFormElement>) {
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
      onMfaStepUp(Date.parse(result.validUntil));
      setRecoveryCodes(result);
      setRecoveryCodesSaved(false);
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

  async function finishMfaEnrollment() {
    if (!recoveryCodesSaved || mfaBusy) return;
    setMfaBusy(true);
    setMfaError('');
    try {
      setRecoveryCodes(null);
      setMfaStage(null);
      await refresh(true);
      setNotice('MFA فعال شد؛ مجوزهای ثبت و مدیریت دوباره از سرور بررسی شدند.');
    } finally {
      setMfaBusy(false);
    }
  }

  return (
    <section className={styles.manager} aria-labelledby="device-management-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ثبت پایدار و پایش heartbeat</p>
          <h2 id="device-management-title">دستگاه‌های شعبه</h2>
          <p className={styles.explainer}>
            وضعیت سلامت از آخرین مشاهده‌ی معتبر Device Integration محاسبه می‌شود؛ این صفحه امکان ثبت
            سلامت دستی ندارد.
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            tone="ghost"
            disabled={loading || loadingMore}
            onClick={() => void refresh(false)}
          >
            تازه‌سازی
          </Button>
          {canRegister && (
            <Button type="button" onClick={() => setRegistrationOpen((open) => !open)}>
              {registrationOpen ? 'بستن فرم ثبت' : 'ثبت دستگاه'}
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}
      {scope.type === 'organization' &&
        capabilities.canRegister &&
        !capabilities.canReadBranches && (
          <p className={styles.warning} role="status">
            برای ثبت دستگاه در محدوده‌ی مجموعه، مجوز مشاهده‌ی شعب (branch.read) نیز لازم است.
          </p>
        )}
      {!capabilities.canRegister && !capabilities.canManage && (
        <Surface className={styles.mfaPanel} aria-labelledby="device-mfa-title">
          <div className={styles.mfaHeading}>
            <div>
              <h3 id="device-mfa-title">تأیید MFA برای عملیات حساس</h3>
              <p className={styles.helper}>
                ثبت و تغییر چرخه‌عمر به مجوز نقش و step-up کوتاه‌مدت نیاز دارد. بررسی نهایی همیشه در
                سرور انجام می‌شود.
              </p>
            </div>
            {!mfaStage && !(mfaStepUpUntil && mfaStepUpUntil > Date.now()) && (
              <Button
                type="button"
                tone="secondary"
                disabled={mfaBusy}
                onClick={() => void openMfaStepUp()}
              >
                {mfaBusy ? 'در حال بررسی…' : 'احراز MFA در این نشست'}
              </Button>
            )}
          </div>
          {!mfaStage && mfaStepUpUntil && mfaStepUpUntil > Date.now() && (
            <p className={styles.helper} role="status">
              MFA این نشست تأیید شده است، اما IAM برای این محدوده مجوز ثبت یا مدیریت دستگاه نداده
              است؛ برای دسترسی با مدیر سامانه تماس بگیرید.
            </p>
          )}
          {mfaError && (
            <p className={styles.error} role="alert">
              {mfaError}
            </p>
          )}
          {mfaStage === 'verify' && (
            <form className={styles.mfaForm} onSubmit={(event) => void verifyMfa(event)}>
              <label className={styles.field} htmlFor="device-mfa-method">
                روش تأیید
                <select
                  id="device-mfa-method"
                  disabled={mfaBusy}
                  value={mfaMethod}
                  onChange={(event) =>
                    setMfaMethod(event.currentTarget.value as 'totp' | 'recovery')
                  }
                >
                  <option value="totp">کد برنامه‌ی رمزساز</option>
                  <option value="recovery">کد بازیابی یک‌بارمصرف</option>
                </select>
              </label>
              <label className={styles.field} htmlFor="device-mfa-code">
                {mfaMethod === 'totp' ? 'کد ۶ رقمی' : 'کد بازیابی'}
                <input
                  id="device-mfa-code"
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode={mfaMethod === 'totp' ? 'numeric' : 'text'}
                  maxLength={mfaMethod === 'totp' ? 6 : 35}
                  required
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.currentTarget.value)}
                />
              </label>
              <Button type="submit" disabled={mfaBusy}>
                {mfaBusy ? 'در حال تأیید…' : 'تأیید و بازخوانی مجوزها'}
              </Button>
            </form>
          )}
          {mfaStage === 'start-enrollment' && (
            <div className={styles.mfaForm}>
              <p className={styles.helper}>
                برای عملیات حساس، برنامه‌ی رمزساز را راه‌اندازی کنید؛ پیامک جایگزین MFA نیست.
              </p>
              <Button type="button" disabled={mfaBusy} onClick={() => void beginMfaEnrollment()}>
                {mfaBusy
                  ? 'در حال آماده‌سازی…'
                  : mfaStatus?.enrollmentPending
                    ? 'ادامه‌ی راه‌اندازی MFA'
                    : 'راه‌اندازی MFA'}
              </Button>
            </div>
          )}
          {mfaStage === 'confirm-enrollment' && enrollment && (
            <form className={styles.mfaForm} onSubmit={(event) => void confirmMfaEnrollment(event)}>
              <p className={styles.helper}>
                کلید را در برنامه‌ی رمزساز وارد و کد همان برنامه را ثبت کنید. کلید فقط در این نشست
                نمایش داده می‌شود.
              </p>
              <code className={styles.secretCode} dir="ltr">
                {enrollment.secret}
              </code>
              <p className={styles.helper}>مهلت راه‌اندازی: {formatDate(enrollment.expiresAt)}</p>
              <label className={styles.field} htmlFor="device-mfa-enrollment-code">
                کد برنامه‌ی رمزساز
                <input
                  id="device-mfa-enrollment-code"
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={enrollmentCode}
                  onChange={(event) => setEnrollmentCode(event.currentTarget.value)}
                />
              </label>
              <Button type="submit" disabled={mfaBusy}>
                {mfaBusy ? 'در حال فعال‌سازی…' : 'فعال‌سازی و دریافت کدهای بازیابی'}
              </Button>
            </form>
          )}
          {mfaStage === 'save-recovery' && recoveryCodes && (
            <div className={styles.mfaForm}>
              <p className={styles.warning}>
                این کدهای بازیابی فقط همین یک‌بار نمایش داده می‌شوند. آن‌ها را در محل امن ذخیره
                کنید.
              </p>
              <ol className={styles.recoveryCodes} dir="ltr">
                {recoveryCodes.recoveryCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ol>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={recoveryCodesSaved}
                  onChange={(event) => setRecoveryCodesSaved(event.currentTarget.checked)}
                />
                کدها را در محل امن ذخیره کردم
              </label>
              <Button
                type="button"
                disabled={!recoveryCodesSaved || mfaBusy}
                onClick={() => void finishMfaEnrollment()}
              >
                {mfaBusy ? 'در حال ادامه…' : 'ادامه و بررسی مجوزها'}
              </Button>
            </div>
          )}
        </Surface>
      )}
      {loadError && (
        <div className={styles.errorBlock} role="alert">
          <p>{loadError}</p>
          <Button type="button" tone="ghost" onClick={() => void refresh(false)}>
            تلاش دوباره
          </Button>
        </div>
      )}

      {registrationOpen && canRegister && (
        <Surface className={styles.panel}>
          <h3>ثبت هویت دستگاه</h3>
          <p className={styles.helper}>
            شناسه‌ی دستگاه باید با شناسه‌ای که آداپتر مجاز گزارش می‌کند یکسان باشد؛ آن را با شماره
            یا شناسه‌ی کارت مشتری اشتباه نگیرید.
          </p>
          <form className={styles.formGrid} onSubmit={submitRegistration}>
            {scope.type === 'organization' && (
              <label className={styles.field} htmlFor="device-registration-branch">
                شعبه مقصد
                <select
                  id="device-registration-branch"
                  required
                  value={registrationDraft.branchId}
                  onChange={(event) =>
                    setRegistrationDraft((current) => ({
                      ...current,
                      branchId: event.currentTarget.value,
                    }))
                  }
                >
                  <option value="">انتخاب شعبه</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} — {branch.city}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.field} htmlFor="device-display-name">
              نام نمایشی
              <input
                id="device-display-name"
                required
                minLength={1}
                maxLength={120}
                value={registrationDraft.displayName}
                onChange={(event) =>
                  setRegistrationDraft((current) => ({
                    ...current,
                    displayName: event.currentTarget.value,
                  }))
                }
              />
            </label>
            <label className={styles.field} htmlFor="device-adapter-key">
              کلید آداپتر
              <input
                id="device-adapter-key"
                required
                pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
                minLength={1}
                maxLength={60}
                dir="ltr"
                value={registrationDraft.adapterKey}
                onChange={(event) =>
                  setRegistrationDraft((current) => ({
                    ...current,
                    adapterKey: event.currentTarget.value,
                  }))
                }
              />
            </label>
            <label className={styles.field} htmlFor="device-external-id">
              شناسه در سامانه دستگاه
              <input
                id="device-external-id"
                required
                minLength={1}
                maxLength={160}
                dir="ltr"
                autoComplete="off"
                value={registrationDraft.externalDeviceId}
                onChange={(event) =>
                  setRegistrationDraft((current) => ({
                    ...current,
                    externalDeviceId: event.currentTarget.value,
                  }))
                }
              />
            </label>
            <label className={styles.field} htmlFor="device-type">
              نوع دستگاه
              <select
                id="device-type"
                value={registrationDraft.deviceType}
                onChange={(event) =>
                  setRegistrationDraft((current) => ({
                    ...current,
                    deviceType: event.currentTarget.value as OperationsDevice['deviceType'],
                  }))
                }
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor="device-registration-reason">
              دلیل ثبت
              <textarea
                id="device-registration-reason"
                required
                minLength={8}
                maxLength={500}
                value={registrationDraft.reason}
                onChange={(event) =>
                  setRegistrationDraft((current) => ({
                    ...current,
                    reason: event.currentTarget.value,
                  }))
                }
              />
            </label>
            {scope.type === 'organization' && branchesError && (
              <p className={styles.warning} role="status">
                {branchesError} ثبت در سطح مجموعه تا انتخاب شعبه‌ی مجاز ممکن نیست.
              </p>
            )}
            {scope.type === 'organization' && branchCursor && (
              <Button
                type="button"
                tone="ghost"
                disabled={loadingBranches}
                onClick={() => void loadBranchPage(branchCursor)}
              >
                {loadingBranches ? 'در حال دریافت…' : 'دریافت شعب بیشتر'}
              </Button>
            )}
            <div className={styles.formActions}>
              <Button
                type="submit"
                disabled={actionBusy || (scope.type === 'organization' && branches.length === 0)}
              >
                {actionBusy ? 'در حال ثبت…' : 'ثبت دستگاه'}
              </Button>
              <Button
                type="button"
                tone="ghost"
                disabled={actionBusy}
                onClick={() => setRegistrationOpen(false)}
              >
                انصراف
              </Button>
            </div>
          </form>
        </Surface>
      )}

      {!loading && !loadError && (
        <div className={styles.summary} aria-label="خلاصه‌ی سلامت دستگاه‌های بارگذاری‌شده">
          <Surface className={styles.metric}>
            <span>آنلاین</span>
            <strong>{toPersianDigits(healthCounts.online)}</strong>
          </Surface>
          <Surface className={styles.metric}>
            <span>نیازمند پیگیری</span>
            <strong>{toPersianDigits(healthCounts.attention)}</strong>
          </Surface>
          <Surface className={styles.metric}>
            <span>بدون مشاهده معتبر</span>
            <strong>{toPersianDigits(healthCounts.unknown)}</strong>
          </Surface>
        </div>
      )}

      <Surface className={styles.filters} aria-label="فیلتر دستگاه‌ها">
        <label className={styles.field} htmlFor="device-search">
          جست‌وجو
          <input
            id="device-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="نام، آداپتر یا شناسه"
          />
        </label>
        <label className={styles.field} htmlFor="device-health-filter">
          سلامت
          <select
            id="device-health-filter"
            value={healthFilter}
            onChange={(event) => setHealthFilter(event.currentTarget.value as HealthFilter)}
          >
            <option value="all">همه وضعیت‌ها</option>
            {Object.entries(healthLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} htmlFor="device-lifecycle-filter">
          وضعیت چرخه عمر
          <select
            id="device-lifecycle-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as StatusFilter)}
          >
            <option value="all">همه</option>
            {Object.entries(lifecycleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} htmlFor="device-type-filter">
          نوع دستگاه
          <select
            id="device-type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.currentTarget.value as DeviceTypeFilter)}
          >
            <option value="all">همه انواع</option>
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {scope.type === 'organization' && branches.length > 0 && (
          <label className={styles.field} htmlFor="device-branch-filter">
            شعبه
            <select
              id="device-branch-filter"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.currentTarget.value)}
            >
              <option value="all">همه شعب بارگذاری‌شده</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.checkField}>
          <input
            type="checkbox"
            checked={showFollowUp}
            onChange={(event) => setShowFollowUp(event.currentTarget.checked)}
          />{' '}
          فقط نیازمند پیگیری (اختلال، داده کهنه یا آفلاین)
        </label>
        {scope.type === 'organization' && branchCursor && (
          <Button
            type="button"
            tone="ghost"
            disabled={loadingBranches}
            onClick={() => void loadBranchPage(branchCursor)}
          >
            {loadingBranches ? 'در حال دریافت شعب…' : 'دریافت شعب بیشتر برای فیلتر'}
          </Button>
        )}
        <p className={styles.filterNote}>
          فیلتر سلامت، نوع، شعبه و جست‌وجو روی صفحات بارگذاری‌شده اعمال می‌شود؛ وضعیت چرخه عمر از
          سرور فیلتر می‌شود.
        </p>
      </Surface>

      {loading && devices.length === 0 ? (
        <Surface className={styles.state} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          در حال دریافت وضعیت واقعی دستگاه‌ها…
        </Surface>
      ) : null}
      {!loading && !loadError && devices.length === 0 && (
        <Surface className={styles.state}>
          <h3>دستگاهی در این محدوده ثبت نشده</h3>
          <p>پس از ثبت در شعبه، سلامت دستگاه تا رسیدن مشاهده معتبر «ناشناخته» می‌ماند.</p>
        </Surface>
      )}
      {!loading && !loadError && devices.length > 0 && visibleDevices.length === 0 && (
        <Surface className={styles.state}>
          <h3>نتیجه‌ای با این فیلترها پیدا نشد</h3>
          <p>فیلترها را تغییر دهید یا فهرست بیشتری بارگذاری کنید.</p>
        </Surface>
      )}

      {visibleDevices.length > 0 && (
        <div className={styles.deviceList} aria-live="polite">
          {visibleDevices.map((device) => {
            const allowedTransitions =
              device.status === 'active'
                ? (['suspended', 'retired'] as const)
                : device.status === 'suspended'
                  ? (['active', 'retired'] as const)
                  : [];
            return (
              <Surface className={styles.deviceCard} key={device.id}>
                <div className={styles.deviceHeader}>
                  <div className={styles.deviceIdentity}>
                    <div className={styles.titleLine}>
                      <h3>{device.displayName}</h3>
                      <Badge tone={healthTones[device.healthState]}>
                        {healthLabels[device.healthState]}
                      </Badge>
                    </div>
                    <p>
                      {typeLabels[device.deviceType]} ·{' '}
                      {branchNames.get(device.branchId) ?? `شعبه ${device.branchId.slice(0, 8)}`}
                    </p>
                  </div>
                  <Badge
                    tone={
                      device.status === 'active'
                        ? 'success'
                        : device.status === 'suspended'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {lifecycleLabels[device.status]}
                  </Badge>
                </div>
                <dl className={styles.details}>
                  <div>
                    <dt>آداپتر</dt>
                    <dd dir="ltr">{device.adapterKey}</dd>
                  </div>
                  <div>
                    <dt>شناسه دستگاه</dt>
                    <dd dir="ltr">{device.externalDeviceId}</dd>
                  </div>
                  <div>
                    <dt>آخرین مشاهده معتبر</dt>
                    <dd>
                      {device.latestObservedAt
                        ? formatDate(device.latestObservedAt)
                        : 'هنوز مشاهده معتبر دریافت نشده'}
                    </dd>
                  </div>
                  <div>
                    <dt>تازگی داده</dt>
                    <dd>
                      {device.freshnessSeconds === null
                        ? 'نامشخص'
                        : formatAge(device.freshnessSeconds)}
                    </dd>
                  </div>
                  <div>
                    <dt>گزارش آداپتر</dt>
                    <dd>
                      {device.latestReportedState
                        ? healthLabels[device.latestReportedState]
                        : 'بدون گزارش'}
                    </dd>
                  </div>
                  <div>
                    <dt>نسخه رکورد</dt>
                    <dd dir="ltr">{toPersianDigits(device.version)}</dd>
                  </div>
                </dl>
                {device.healthState === 'unknown' && (
                  <p className={styles.unknownNote}>
                    این دستگاه ثبت شده اما هنوز heartbeat یا مشاهده‌ی معتبر برای آن دریافت نشده؛ آن
                    را آنلاین فرض نکنید.
                  </p>
                )}
                {['degraded', 'stale', 'offline'].includes(device.healthState) && (
                  <p className={styles.warning}>
                    نیازمند پیگیری: وضعیت بالا از مشاهده‌ی معتبر/آستانه تازگی محاسبه شده است. اتصال
                    فیزیکی و رخدادها را در سامانه‌ی مالک بررسی کنید.
                  </p>
                )}
                {capabilities.canManage && device.status !== 'retired' && (
                  <details
                    className={styles.manageDetails}
                    open={editingDeviceId === device.id}
                    onToggle={(event) => {
                      if (
                        !(event.currentTarget as HTMLDetailsElement).open &&
                        editingDeviceId === device.id
                      )
                        setEditingDeviceId(null);
                    }}
                  >
                    <summary
                      onClick={(event) => {
                        if (editingDeviceId !== device.id) {
                          setDeviceDraft({
                            displayName: device.displayName,
                            status: '',
                            reason: '',
                            confirmRetirement: false,
                          });
                          setActionError('');
                          setEditingDeviceId(device.id);
                        } else {
                          event.preventDefault();
                          setEditingDeviceId(null);
                        }
                      }}
                    >
                      مدیریت چرخه عمر
                    </summary>
                    {editingDeviceId === device.id && (
                      <form
                        className={styles.editForm}
                        onSubmit={(event) => void submitDeviceUpdate(event, device)}
                      >
                        <label className={styles.field} htmlFor={`device-name-${device.id}`}>
                          نام نمایشی
                          <input
                            id={`device-name-${device.id}`}
                            maxLength={120}
                            value={deviceDraft.displayName}
                            onChange={(event) =>
                              setDeviceDraft((current) => ({
                                ...current,
                                displayName: event.currentTarget.value,
                              }))
                            }
                          />
                        </label>
                        <label className={styles.field} htmlFor={`device-status-${device.id}`}>
                          تغییر وضعیت
                          <select
                            id={`device-status-${device.id}`}
                            value={deviceDraft.status}
                            onChange={(event) =>
                              setDeviceDraft((current) => ({
                                ...current,
                                status: event.currentTarget.value as DeviceDraft['status'],
                                confirmRetirement: false,
                              }))
                            }
                          >
                            <option value="">بدون تغییر ({lifecycleLabels[device.status]})</option>
                            {allowedTransitions.map((status) => (
                              <option key={status} value={status}>
                                {lifecycleLabels[status]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.field} htmlFor={`device-reason-${device.id}`}>
                          دلیل تغییر
                          <textarea
                            id={`device-reason-${device.id}`}
                            required
                            minLength={8}
                            maxLength={500}
                            value={deviceDraft.reason}
                            onChange={(event) =>
                              setDeviceDraft((current) => ({
                                ...current,
                                reason: event.currentTarget.value,
                              }))
                            }
                          />
                        </label>
                        {deviceDraft.status === 'retired' && (
                          <label className={styles.checkField}>
                            <input
                              type="checkbox"
                              required
                              checked={deviceDraft.confirmRetirement}
                              onChange={(event) =>
                                setDeviceDraft((current) => ({
                                  ...current,
                                  confirmRetirement: event.currentTarget.checked,
                                }))
                              }
                            />
                            بازنشستگی دائمی است و قابل فعال‌سازی مجدد نیست؛ تأیید می‌کنم
                          </label>
                        )}
                        <div className={styles.formActions}>
                          <Button type="submit" disabled={actionBusy}>
                            {actionBusy ? 'در حال ذخیره…' : 'ذخیره تغییر'}
                          </Button>
                        </div>
                      </form>
                    )}
                  </details>
                )}
              </Surface>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <Button
          className={styles.loadMore}
          type="button"
          tone="secondary"
          disabled={loadingMore || loading}
          onClick={() => void loadMoreDevices()}
        >
          {loadingMore ? 'در حال دریافت…' : 'بارگذاری دستگاه‌های بیشتر'}
        </Button>
      )}
      {pagesLoaded.current > 1 && (
        <p className={styles.lastUpdated} role="status">
          با بارگذاری صفحات بعدی، تازه‌سازی خودکار متوقف است؛ تازه‌سازی دستی فهرست را به صفحه‌ی نخست
          بازمی‌گرداند.
        </p>
      )}
      {lastUpdatedAt !== null && (
        <p className={styles.lastUpdated} role="status">
          آخرین دریافت: {formatDate(new Date(lastUpdatedAt).toISOString())} · تازه‌سازی خودکار هر ۶۰
          ثانیه در زمان فعال بودن صفحه
        </p>
      )}
    </section>
  );
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403) return 'برای این محدوده یا عملیات مجوز لازم را ندارید.';
    if (failure.status === 409)
      return 'عملیات با وضعیت فعلی تعارض دارد؛ فهرست را تازه کنید و اگر شناسه تکراری است، شناسه دیگری وارد کنید.';
    if (failure.status === 503)
      return 'یکی از سرویس‌های مالک در دسترس نیست؛ داده‌ی قبلی را به‌روز فرض نکنید و بعداً دوباره تلاش کنید.';
    if (failure.status === 0)
      return 'ارتباط با سرویس برقرار نشد. اتصال را بررسی و دوباره تلاش کنید.';
    return failure.message;
  }
  return 'دریافت یا ذخیره‌ی اطلاعات دستگاه انجام نشد. دوباره تلاش کنید.';
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fa')
    .trim();
}

function dedupeDevices(items: OperationsDevice[]) {
  const byId = new Map<string, OperationsDevice>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function appendUnique(current: OperationsDeviceBranch[], incoming: OperationsDeviceBranch[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function toPersianDigits(value: number) {
  return new Intl.NumberFormat('fa-IR').format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'زمان نامعتبر';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${toPersianDigits(seconds)} ثانیه پیش`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${toPersianDigits(hours)} ساعت پیش`;
  return `${toPersianDigits(Math.floor(hours / 24))} روز پیش`;
}

function healthPriority(state: OperationsDevice['healthState']) {
  if (state === 'offline') return 0;
  if (state === 'stale') return 1;
  if (state === 'degraded') return 2;
  return 3;
}
