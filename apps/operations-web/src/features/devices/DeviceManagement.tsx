'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Surface } from '@funtino/design-system';
import { OperationsManagementList } from '../../components/workspace-shell/OperationsManagementList';
import { ApiRequestError } from '../../lib/api/client';
import {
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
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
};
type HealthFilter = 'all' | OperationsDevice['healthState'];
type DeviceTypeFilter = 'all' | OperationsDevice['deviceType'];
type StatusFilter = 'all' | OperationsDevice['status'];
type DeviceDraft = {
  displayName: string;
  status: '' | OperationsDevice['status'];
  reason: string;
};
type DeviceFilters = {
  health: HealthFilter;
  type: DeviceTypeFilter;
  status: StatusFilter;
  branchId: string;
  followUp: boolean;
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

export function DeviceManagement({ scope, scopeOption, onSessionExpired }: Props) {
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
  const [filterDraft, setFilterDraft] = useState<DeviceFilters>({
    health: 'all',
    type: 'all',
    status: 'all',
    branchId: 'all',
    followUp: false,
  });
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [retirementDevice, setRetirementDevice] = useState<OperationsDevice | null>(null);
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
  });
  const registrationDialogRef = useRef<HTMLDialogElement>(null);
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const retirementDialogRef = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    const dialog = registrationDialogRef.current;
    if (registrationOpen && dialog && !dialog.open) dialog.showModal();
    if (!registrationOpen && dialog?.open) dialog.close();
  }, [registrationOpen]);

  useEffect(() => {
    const dialog = editDialogRef.current;
    if (editingDeviceId && dialog && !dialog.open) dialog.showModal();
    if (!editingDeviceId && dialog?.open) dialog.close();
  }, [editingDeviceId]);

  useEffect(() => {
    const dialog = retirementDialogRef.current;
    if (retirementDevice && dialog && !dialog.open) dialog.showModal();
    if (!retirementDevice && dialog?.open) dialog.close();
  }, [retirementDevice]);

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
              name: activeOption.branch?.name.trim() || 'شعبه بدون نام نمایشی',
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
              name: activeOption.branch?.name.trim() || 'شعبه بدون نام نمایشی',
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
    setFilterDraft({ health: 'all', type: 'all', status: 'all', branchId: 'all', followUp: false });
    setRegistrationOpen(false);
    setEditingDeviceId(null);
    setRetirementDevice(null);
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
          [deviceDisplayName(device), typeLabels[device.deviceType], branchName].join(' '),
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
  const deviceGroups = useMemo(() => {
    if (scope.type !== 'organization')
      return [{ key: 'active-branch', heading: '', devices: visibleDevices }];
    const groups = new Map<string, { key: string; heading: string; devices: OperationsDevice[] }>();
    for (const device of visibleDevices) {
      const heading = branchNames.get(device.branchId)?.trim() || 'شعبه بدون نام نمایشی';
      const group = groups.get(device.branchId) ?? { key: device.branchId, heading, devices: [] };
      group.devices.push(device);
      groups.set(device.branchId, group);
    }
    return [...groups.values()].sort((left, right) =>
      left.heading.localeCompare(right.heading, 'fa'),
    );
  }, [branchNames, scope.type, visibleDevices]);

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
      ...(registrationDraft.reason.trim() ? { reason: registrationDraft.reason.trim() } : {}),
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
    const body: { displayName?: string; status?: OperationsDevice['status']; reason?: string } = {};
    if (deviceDraft.reason.trim()) body.reason = deviceDraft.reason.trim();
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

  async function retireDevice() {
    const device = retirementDevice;
    if (!device || !capabilities.canManage || actionBusy) return;
    const body = { status: 'retired' as const };
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
      setRetirementDevice(null);
      setNotice('دستگاه بازنشسته شد و دیگر قابل فعال‌سازی نیست.');
      await refresh(true);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setActionError(messageFor(failure));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className={styles.manager}>
      <OperationsManagementList
        title="دستگاه‌ها"
        description="فهرست دستگاه‌ها و وضعیت سلامت دریافتی از سامانه‌ی مالک را مدیریت کنید."
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="جست‌وجوی نام دستگاه، نوع یا شعبه"
        searchPlaceholder="نام دستگاه، نوع یا شعبه را جست‌وجو کنید"
        toolbarLabel="جست‌وجو و فیلتر دستگاه‌ها"
        filterTitle="فیلتر دستگاه‌ها"
        filterDescription="وضعیت چرخه‌عمر از سرور دریافت می‌شود؛ سلامت، نوع، شعبه و جست‌وجو فقط روی صفحه‌های دریافت‌شده اعمال می‌شوند."
        loadMoreLabel="بارگذاری دستگاه‌های بیشتر"
        filterFields={
          <>
            <label className={styles.field} htmlFor="device-health-filter">
              سلامت
              <select
                id="device-health-filter"
                value={filterDraft.health}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    health: event.currentTarget.value as HealthFilter,
                  }))
                }
              >
                <option value="all">همه‌ی وضعیت‌ها</option>
                {Object.entries(healthLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor="device-lifecycle-filter">
              وضعیت چرخه‌عمر
              <select
                id="device-lifecycle-filter"
                value={filterDraft.status}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    status: event.currentTarget.value as StatusFilter,
                  }))
                }
              >
                <option value="all">همه‌ی وضعیت‌ها</option>
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
                value={filterDraft.type}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    type: event.currentTarget.value as DeviceTypeFilter,
                  }))
                }
              >
                <option value="all">همه‌ی انواع</option>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {scope.type === 'organization' && capabilities.canReadBranches && (
              <label className={styles.field} htmlFor="device-branch-filter">
                شعبه
                <select
                  id="device-branch-filter"
                  value={filterDraft.branchId}
                  onChange={(event) =>
                    setFilterDraft((current) => ({
                      ...current,
                      branchId: event.currentTarget.value,
                    }))
                  }
                >
                  <option value="all">همه‌ی شعب</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name.trim() || 'شعبه بدون نام نمایشی'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={filterDraft.followUp}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    followUp: event.currentTarget.checked,
                  }))
                }
              />
              فقط دستگاه‌های نیازمند پیگیری
            </label>
            {scope.type === 'organization' && branchCursor && (
              <Button
                type="button"
                tone="ghost"
                disabled={loadingBranches}
                onClick={() => void loadBranchPage(branchCursor)}
              >
                {loadingBranches ? 'در حال دریافت شعب…' : 'دریافت شعب بیشتر'}
              </Button>
            )}
          </>
        }
        onApplyFilters={() => {
          setHealthFilter(filterDraft.health);
          setTypeFilter(filterDraft.type);
          setStatusFilter(filterDraft.status);
          setBranchFilter(filterDraft.branchId);
          setShowFollowUp(filterDraft.followUp);
        }}
        onClearFilters={() => {
          setFilterDraft({
            health: 'all',
            type: 'all',
            status: 'all',
            branchId: 'all',
            followUp: false,
          });
          setHealthFilter('all');
          setTypeFilter('all');
          setStatusFilter('all');
          setBranchFilter('all');
          setShowFollowUp(false);
        }}
        appliedFilterCount={
          Number(healthFilter !== 'all') +
          Number(typeFilter !== 'all') +
          Number(statusFilter !== 'all') +
          Number(branchFilter !== 'all') +
          Number(showFollowUp)
        }
        filtersBusy={loading || loadingBranches}
        showHeading={false}
        pagination={{
          hasMore: Boolean(nextCursor),
          busy: loadingMore || loading,
          onLoadMore: () => void loadMoreDevices(),
        }}
        toolbarActions={
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
              <Button
                className={styles.addButton}
                type="button"
                onClick={() => setRegistrationOpen(true)}
              >
                <DeviceIcon kind="add" />
                افزودن دستگاه
              </Button>
            )}
          </div>
        }
      >
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
        {loadError && (
          <div className={styles.errorBlock} role="alert">
            <p>{loadError}</p>
            <Button type="button" tone="ghost" onClick={() => void refresh(false)}>
              تلاش دوباره
            </Button>
          </div>
        )}

        {registrationOpen && canRegister && (
          <dialog
            aria-labelledby="device-registration-title"
            className={styles.dialog}
            onCancel={(event) => {
              event.preventDefault();
              setRegistrationOpen(false);
            }}
            onClose={() => setRegistrationOpen(false)}
            ref={registrationDialogRef}
          >
            <div className={styles.dialogBody}>
              <header className={styles.dialogHeader}>
                <div>
                  <h3 id="device-registration-title">افزودن دستگاه</h3>
                  <p>
                    هویت دستگاه ثبت می‌شود؛ وضعیت سلامت تا دریافت مشاهده‌ی معتبر نامشخص می‌ماند.
                  </p>
                </div>
                <button
                  aria-label="بستن فرم افزودن دستگاه"
                  className={styles.closeButton}
                  onClick={() => setRegistrationOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </header>
              <Surface className={styles.panel}>
                <p className={styles.helper}>
                  شناسه‌ی دستگاه باید با شناسه‌ای که آداپتر مجاز گزارش می‌کند یکسان باشد؛ آن را با
                  شماره یا شناسه‌ی کارت مشتری اشتباه نگیرید.
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
                            {[branch.name.trim() || 'شعبه بدون نام نمایشی', branch.city]
                              .filter(Boolean)
                              .join(' — ')}
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
                    دلیل ثبت (اختیاری)
                    <textarea
                      id="device-registration-reason"
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
                      disabled={
                        actionBusy || (scope.type === 'organization' && branches.length === 0)
                      }
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
            </div>
          </dialog>
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
            {deviceGroups.map((group) => (
              <section
                className={styles.deviceGroup}
                key={group.key}
                aria-label={group.heading || 'دستگاه‌های شعبه'}
              >
                {group.heading && <h3 className={styles.groupHeading}>{group.heading}</h3>}
                <div className={styles.groupRows}>
                  {group.devices.map((device) => (
                    <Surface className={styles.deviceCard} key={device.id}>
                      <div className={styles.deviceHeader}>
                        <div className={styles.deviceIdentity}>
                          <div className={styles.titleLine}>
                            <h3>{deviceDisplayName(device)}</h3>
                            <Badge tone={healthTones[device.healthState]}>
                              {healthLabels[device.healthState]}
                            </Badge>
                          </div>
                          <p>
                            {typeLabels[device.deviceType]} ·{' '}
                            {branchNames.get(device.branchId)?.trim() || 'نام شعبه در دسترس نیست'}
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
                      <dl className={styles.rowDetails}>
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
                      </dl>
                      <div
                        className={styles.rowActions}
                        aria-label={`عملیات ${deviceDisplayName(device)}`}
                      >
                        <Link
                          className={styles.iconButton}
                          href={`/devices/${encodeURIComponent(device.id)}`}
                          aria-label={`جزئیات ${deviceDisplayName(device)}`}
                          title="جزئیات"
                        >
                          <DeviceIcon kind="details" />
                        </Link>
                        {capabilities.canManage && device.status !== 'retired' && (
                          <>
                            <button
                              className={styles.iconButton}
                              type="button"
                              aria-label={`ویرایش ${deviceDisplayName(device)}`}
                              title="ویرایش"
                              onClick={() => {
                                setDeviceDraft({
                                  displayName: device.displayName,
                                  status: '',
                                  reason: '',
                                });
                                setActionError('');
                                setEditingDeviceId(device.id);
                              }}
                            >
                              <DeviceIcon kind="edit" />
                            </button>
                            <button
                              className={`${styles.iconButton} ${styles.dangerIconButton}`}
                              type="button"
                              aria-label={`بازنشسته‌سازی دائمی ${deviceDisplayName(device)}`}
                              title="بازنشسته‌سازی دائمی"
                              onClick={() => {
                                setActionError('');
                                setRetirementDevice(device);
                              }}
                            >
                              <DeviceIcon kind="delete" />
                            </button>
                          </>
                        )}
                      </div>
                      {device.healthState === 'unknown' && (
                        <p className={styles.unknownNote}>
                          این دستگاه ثبت شده اما هنوز heartbeat یا مشاهده‌ی معتبر برای آن دریافت
                          نشده؛ آن را آنلاین فرض نکنید.
                        </p>
                      )}
                      {['degraded', 'stale', 'offline'].includes(device.healthState) && (
                        <p className={styles.warning}>
                          نیازمند پیگیری: وضعیت بالا از مشاهده‌ی معتبر/آستانه تازگی محاسبه شده است.
                          اتصال فیزیکی و رخدادها را در سامانه‌ی مالک بررسی کنید.
                        </p>
                      )}
                    </Surface>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {pagesLoaded.current > 1 && (
          <p className={styles.lastUpdated} role="status">
            با بارگذاری صفحات بعدی، تازه‌سازی خودکار متوقف است؛ تازه‌سازی دستی فهرست را به صفحه‌ی
            نخست بازمی‌گرداند.
          </p>
        )}
        {lastUpdatedAt !== null && (
          <p className={styles.lastUpdated} role="status">
            آخرین دریافت: {formatDate(new Date(lastUpdatedAt).toISOString())} · تازه‌سازی خودکار هر
            ۶۰ ثانیه در زمان فعال بودن صفحه
          </p>
        )}
        {editingDeviceId && devices.some((device) => device.id === editingDeviceId) && (
          <dialog
            aria-labelledby="device-edit-title"
            className={styles.dialog}
            onCancel={(event) => {
              event.preventDefault();
              setEditingDeviceId(null);
            }}
            onClose={() => setEditingDeviceId(null)}
            ref={editDialogRef}
          >
            {(() => {
              const device = devices.find((item) => item.id === editingDeviceId)!;
              const nextStatus = device.status === 'active' ? 'suspended' : 'active';
              return (
                <div className={styles.dialogBody}>
                  <header className={styles.dialogHeader}>
                    <div>
                      <h3 id="device-edit-title">ویرایش {deviceDisplayName(device)}</h3>
                      <p>نام یا وضعیت چرخه‌عمر دستگاه را به‌روزرسانی کنید.</p>
                    </div>
                    <button
                      aria-label="بستن فرم ویرایش"
                      className={styles.closeButton}
                      onClick={() => setEditingDeviceId(null)}
                      type="button"
                    >
                      ×
                    </button>
                  </header>
                  <form
                    className={styles.editForm}
                    onSubmit={(event) => void submitDeviceUpdate(event, device)}
                  >
                    <label className={styles.field} htmlFor="device-edit-name">
                      نام نمایشی
                      <input
                        id="device-edit-name"
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
                    <label className={styles.field} htmlFor="device-edit-status">
                      وضعیت چرخه‌عمر
                      <select
                        id="device-edit-status"
                        value={deviceDraft.status}
                        onChange={(event) =>
                          setDeviceDraft((current) => ({
                            ...current,
                            status: event.currentTarget.value as DeviceDraft['status'],
                          }))
                        }
                      >
                        <option value="">بدون تغییر ({lifecycleLabels[device.status]})</option>
                        <option value={nextStatus}>{lifecycleLabels[nextStatus]}</option>
                      </select>
                    </label>
                    <label className={styles.field} htmlFor="device-edit-reason">
                      دلیل تغییر (اختیاری)
                      <textarea
                        id="device-edit-reason"
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
                    {actionError && (
                      <p className={styles.error} role="alert">
                        {actionError}
                      </p>
                    )}
                    <div className={styles.formActions}>
                      <Button type="submit" disabled={actionBusy}>
                        {actionBusy ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
                      </Button>
                      <Button
                        type="button"
                        tone="ghost"
                        disabled={actionBusy}
                        onClick={() => setEditingDeviceId(null)}
                      >
                        انصراف
                      </Button>
                    </div>
                  </form>
                </div>
              );
            })()}
          </dialog>
        )}
        {retirementDevice && (
          <dialog
            aria-labelledby="device-retirement-title"
            aria-describedby="device-retirement-description"
            className={styles.dialog}
            onCancel={(event) => {
              event.preventDefault();
              setRetirementDevice(null);
            }}
            onClose={() => setRetirementDevice(null)}
            ref={retirementDialogRef}
          >
            <div className={styles.dialogBody}>
              <header className={styles.dialogHeader}>
                <div>
                  <h3 id="device-retirement-title">بازنشسته‌سازی دائمی دستگاه</h3>
                  <p id="device-retirement-description">
                    «{deviceDisplayName(retirementDevice)}» بازنشسته می‌شود و طبق چرخه‌عمر دستگاه
                    قابل فعال‌سازی مجدد نیست.
                  </p>
                </div>
                <button
                  aria-label="بستن تأیید بازنشستگی"
                  className={styles.closeButton}
                  onClick={() => setRetirementDevice(null)}
                  type="button"
                >
                  ×
                </button>
              </header>
              {actionError && (
                <p className={styles.error} role="alert">
                  {actionError}
                </p>
              )}
              <div className={styles.formActions}>
                <Button
                  type="button"
                  tone="danger"
                  disabled={actionBusy}
                  onClick={() => void retireDevice()}
                >
                  {actionBusy ? 'در حال ثبت…' : 'تأیید بازنشستگی'}
                </Button>
                <Button
                  type="button"
                  tone="ghost"
                  disabled={actionBusy}
                  onClick={() => setRetirementDevice(null)}
                >
                  انصراف
                </Button>
              </div>
            </div>
          </dialog>
        )}
      </OperationsManagementList>
    </div>
  );
}

function DeviceIcon({ kind }: { kind: 'add' | 'details' | 'edit' | 'delete' }) {
  if (kind === 'add')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  if (kind === 'details')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  if (kind === 'edit')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.4 2.4 0 0 0-3.4-3.4L4 16.5Z" />
        <path d="m14.8 5.9 3.4 3.4" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" />
    </svg>
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

function deviceDisplayName(device: OperationsDevice) {
  return device.displayName.trim() || 'دستگاه بدون نام نمایشی';
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
