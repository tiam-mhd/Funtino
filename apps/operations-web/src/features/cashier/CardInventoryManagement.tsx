'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { listOperationsBranches, type OperationsBranch } from '../../lib/api/operations-devices';
import {
  changeOperationsCardStatus,
  listOperationsCards,
  registerOperationsCard,
  type OperationsCard,
  type OperationsCardCapabilities,
  type OperationsCardStatus,
} from '../../lib/api/operations-cards';
import {
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import { OperationsMfaStepUpPanel } from '../../components/forms/OperationsMfaStepUpPanel';
import { HouseholdCardAssignments } from './HouseholdCardAssignments';
import styles from './CardInventoryManagement.module.css';

type Props = {
  scope: OperationsScope;
  scopeOption: OperationsScopeOption;
  onSessionExpired: () => void;
  mfaStepUpUntil: number | null;
  onMfaStepUp: (validUntil: number) => void;
};

type RegistrationDraft = { externalCardId: string; reason: string };
type StatusDraft = {
  status: '' | OperationsCardStatus;
  reason: string;
  confirmRetirement: boolean;
};

const emptyStatusDraft: StatusDraft = { status: '', reason: '', confirmRetirement: false };
const statusLabels: Record<OperationsCardStatus, string> = {
  in_stock: 'موجود در شعبه',
  assigned: 'تخصیص‌یافته به خانواده',
  blocked: 'مسدود',
  retired: 'بازنشسته‌ی دائمی',
};
const verificationLabels: Record<OperationsCard['verificationStatus'], string> = {
  unknown: 'تأییدنشده توسط سامانه کارت',
  verified: 'تأییدشده',
  rejected: 'ردشده توسط سامانه کارت',
};
const statusTones: Record<OperationsCardStatus, 'success' | 'warning' | 'neutral'> = {
  in_stock: 'success',
  assigned: 'neutral',
  blocked: 'warning',
  retired: 'neutral',
};
const noCardCapabilities: OperationsCardCapabilities = {
  canManage: false,
  canAssign: false,
  canTransfer: false,
  canUnassign: false,
  canLookupCustomer: false,
  requiresStepUp: false,
};

export function CardInventoryManagement({
  scope,
  scopeOption,
  onSessionExpired,
  mfaStepUpUntil,
  onMfaStepUp,
}: Props) {
  const currentScopeKey = scopeKey(scope);
  const initialBranches: OperationsBranch[] =
    scope.type === 'branch'
      ? [
          {
            id: scope.branchId,
            organizationId: scope.organizationId,
            name: scopeOption.branch?.name ?? 'شعبه انتخاب‌شده',
            city: scopeOption.branch?.city ?? '',
          },
        ]
      : [];
  const [branches, setBranches] = useState(initialBranches);
  const [branchCursor, setBranchCursor] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState(
    scope.type === 'branch' ? scope.branchId : '',
  );
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState('');
  const [cards, setCards] = useState<OperationsCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [capabilities, setCapabilities] = useState(noCardCapabilities);
  const [statusFilter, setStatusFilter] = useState<'all' | OperationsCardStatus>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationDraft, setRegistrationDraft] = useState<RegistrationDraft>({
    externalCardId: '',
    reason: '',
  });
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [changingCardId, setChangingCardId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<StatusDraft>(emptyStatusDraft);
  const requestVersion = useRef(0);
  const branchBusy = useRef(false);
  const hasLoadedInventory = useRef(false);
  const lastRegistrationAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const lastStatusAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadBranchPage = useCallback(
    async (cursor?: string) => {
      if (scope.type !== 'organization' || branchBusy.current) return;
      branchBusy.current = true;
      setBranchLoading(true);
      setBranchError('');
      try {
        const page = await listOperationsBranches(scope.organizationId, cursor);
        setBranches((current) => (cursor ? appendBranches(current, page.data) : page.data));
        setBranchCursor(page.nextCursor);
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        else setBranchError(messageFor(failure));
      } finally {
        branchBusy.current = false;
        setBranchLoading(false);
      }
    },
    [onSessionExpired, scope.organizationId, scope.type],
  );

  const refresh = useCallback(
    async (quiet = false) => {
      const branchId = selectedBranchId;
      if (!branchId) {
        setCards([]);
        setNextCursor(null);
        setCanManage(false);
        setCapabilities(noCardCapabilities);
        setLoadError('');
        setLastUpdatedAt(null);
        setStale(false);
        hasLoadedInventory.current = false;
        setLoading(false);
        return;
      }
      const requestId = ++requestVersion.current;
      setStale(hasLoadedInventory.current);
      if (!quiet) setLoading(true);
      setLoadError('');
      setActionError('');
      try {
        const page = await listOperationsCards(
          scope.organizationId,
          branchId,
          undefined,
          statusFilter === 'all' ? undefined : statusFilter,
        );
        if (requestId !== requestVersion.current) return;
        setCards(page.data);
        setNextCursor(page.nextCursor);
        setCanManage(page.capabilities.canManage);
        setCapabilities(page.capabilities);
        setLastUpdatedAt(Date.now());
        setStale(false);
        hasLoadedInventory.current = true;
      } catch (failure) {
        if (requestId !== requestVersion.current) return;
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        else setLoadError(messageFor(failure));
      } finally {
        if (requestId === requestVersion.current) setLoading(false);
      }
    },
    [onSessionExpired, scope.organizationId, selectedBranchId, statusFilter],
  );

  useEffect(() => {
    if (scope.type === 'organization') void loadBranchPage();
    return () => {
      requestVersion.current += 1;
    };
  }, [currentScopeKey, loadBranchPage, scope.type]);

  useEffect(() => {
    setCards([]);
    setNextCursor(null);
    setCanManage(false);
    setCapabilities(noCardCapabilities);
    setLastUpdatedAt(null);
    setStale(false);
    hasLoadedInventory.current = false;
    setSearch('');
    setRegistrationOpen(false);
    setRegistrationDraft({ externalCardId: '', reason: '' });
    setChangingCardId(null);
    setStatusDraft(emptyStatusDraft);
    lastRegistrationAttempt.current = null;
    lastStatusAttempt.current = null;
    void refresh(false);
  }, [refresh]);

  const visibleCards = useMemo(() => {
    const normalized = normalizeSearch(search);
    if (!normalized) return cards;
    return cards.filter((card) => normalizeSearch(card.maskedIdentifier).includes(normalized));
  }, [cards, search]);

  async function loadMoreCards() {
    if (!selectedBranchId || !nextCursor || loadingMore || loading) return;
    const requestId = requestVersion.current;
    const cursor = nextCursor;
    setLoadingMore(true);
    setActionError('');
    try {
      const page = await listOperationsCards(
        scope.organizationId,
        selectedBranchId,
        cursor,
        statusFilter === 'all' ? undefined : statusFilter,
      );
      if (requestId !== requestVersion.current) return;
      setCards((current) => appendCards(current, page.data));
      setNextCursor(page.nextCursor);
      setCanManage(page.capabilities.canManage);
      setCapabilities(page.capabilities);
      setLastUpdatedAt(Date.now());
      setStale(false);
      hasLoadedInventory.current = true;
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else {
        if (failure instanceof ApiRequestError && failure.status === 403) setCanManage(false);
        setActionError(messageFor(failure));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranchId || !canManage) return;
    const body = {
      externalCardId: registrationDraft.externalCardId.trim(),
      reason: registrationDraft.reason.trim(),
    };
    const fingerprint = JSON.stringify([scope.organizationId, selectedBranchId, body]);
    const key =
      lastRegistrationAttempt.current?.fingerprint === fingerprint
        ? lastRegistrationAttempt.current.key
        : crypto.randomUUID();
    lastRegistrationAttempt.current = { fingerprint, key };
    setRegistrationBusy(true);
    setActionError('');
    setNotice('');
    try {
      await registerOperationsCard(scope.organizationId, selectedBranchId, body, key);
      lastRegistrationAttempt.current = null;
      setRegistrationDraft({ externalCardId: '', reason: '' });
      setRegistrationOpen(false);
      setNotice('کارت به موجودی Wallet این شعبه اضافه شد؛ تأیید سامانه‌ی کارت هنوز نامشخص است.');
      await refresh(true);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else {
        if (failure instanceof ApiRequestError && failure.status === 403) setCanManage(false);
        setActionError(messageFor(failure));
      }
    } finally {
      setRegistrationBusy(false);
    }
  }

  async function submitStatusChange(event: FormEvent<HTMLFormElement>, card: OperationsCard) {
    event.preventDefault();
    if (!canManage || !statusDraft.status || statusBusy) return;
    if (statusDraft.status === 'retired' && !statusDraft.confirmRetirement) {
      setActionError('برای بازنشستگی دائمی، تأیید نهایی را انتخاب کنید.');
      return;
    }
    const body = { status: statusDraft.status, reason: statusDraft.reason.trim() };
    const fingerprint = JSON.stringify([card.id, card.version, body]);
    const key =
      lastStatusAttempt.current?.fingerprint === fingerprint
        ? lastStatusAttempt.current.key
        : crypto.randomUUID();
    lastStatusAttempt.current = { fingerprint, key };
    setChangingCardId(card.id);
    setStatusBusy(true);
    setActionError('');
    setNotice('');
    try {
      await changeOperationsCardStatus(card, body, key);
      lastStatusAttempt.current = null;
      setStatusDraft(emptyStatusDraft);
      setChangingCardId(null);
      setNotice('وضعیت کارت در Wallet به‌روزرسانی شد.');
      await refresh(true);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else {
        if (failure instanceof ApiRequestError && failure.status === 403) setCanManage(false);
        setActionError(messageFor(failure));
      }
    } finally {
      setStatusBusy(false);
    }
  }

  function toggleRegistration() {
    setRegistrationOpen((open) => !open);
    setRegistrationDraft({ externalCardId: '', reason: '' });
    setActionError('');
    if (registrationOpen) lastRegistrationAttempt.current = null;
  }

  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
  const allowedNextStatuses = (card: OperationsCard) =>
    card.status === 'in_stock'
      ? (['blocked', 'retired'] as const)
      : card.status === 'blocked'
        ? (['in_stock', 'retired'] as const)
        : [];

  return (
    <section className={styles.manager} aria-labelledby="card-inventory-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Wallet · موجودی شعبه</p>
          <h2 id="card-inventory-title">مدیریت موجودی کارت</h2>
          <p className={styles.explainer}>
            این بخش فقط موجودی فیزیکی و چرخه‌ی کارت را از Wallet می‌خواند. شناسه‌ی کامل نمایش داده
            نمی‌شود؛ تخصیص به خانواده/عضو تا اتصال مالک Customer در دسترس نیست.
          </p>
        </div>
        <div className={styles.headerActions}>
          {canManage && selectedBranchId && (
            <Button
              type="button"
              disabled={registrationBusy || statusBusy}
              onClick={toggleRegistration}
            >
              {registrationOpen ? 'بستن فرم ثبت' : 'ثبت کارت در موجودی'}
            </Button>
          )}
          <Button
            type="button"
            tone="ghost"
            disabled={!selectedBranchId || loading}
            onClick={() => void refresh(false)}
          >
            تازه‌سازی
          </Button>
        </div>
      </header>

      {scope.type === 'organization' ? (
        <Surface className={styles.filters}>
          <label className={styles.field} htmlFor="card-inventory-branch">
            شعبه‌ی موجودی
            <select
              id="card-inventory-branch"
              aria-label="شعبه‌ی موجودی کارت"
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.currentTarget.value)}
              disabled={(branchLoading && branches.length === 0) || registrationBusy || statusBusy}
            >
              <option value="">انتخاب شعبه</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} · {branch.city}
                </option>
              ))}
            </select>
          </label>
          {selectedBranch && (
            <p className={styles.branchContext}>محدوده‌ی انتخابی: {selectedBranch.name}</p>
          )}
          {branchCursor && (
            <Button
              type="button"
              tone="ghost"
              disabled={branchLoading}
              onClick={() => void loadBranchPage(branchCursor)}
            >
              {branchLoading ? 'در حال دریافت…' : 'بارگذاری شعب بیشتر'}
            </Button>
          )}
          {branchError && (
            <p className={styles.error} role="alert">
              {branchError}
            </p>
          )}
          {branchError && (
            <Button type="button" tone="ghost" onClick={() => void loadBranchPage()}>
              تلاش دوباره برای دریافت شعب
            </Button>
          )}
        </Surface>
      ) : (
        <Surface className={styles.scopeBanner}>
          <span aria-hidden="true">▣</span>
          <p>
            محدوده‌ی فعال: <strong>{scopeOption.branch?.name ?? 'شعبه انتخاب‌شده'}</strong>
            {scopeOption.branch?.city ? ` · ${scopeOption.branch.city}` : ''}
          </p>
        </Surface>
      )}

      {selectedBranchId &&
        !loadError &&
        !loading &&
        (!canManage || capabilities.requiresStepUp) && (
          <OperationsMfaStepUpPanel
            idPrefix="card-inventory"
            mfaStepUpUntil={mfaStepUpUntil}
            onMfaStepUp={(validUntil) => {
              onMfaStepUp(validUntil);
              void refresh(true);
            }}
            onSessionExpired={onSessionExpired}
          />
        )}

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

      {registrationOpen && canManage && selectedBranchId && (
        <Surface className={styles.panel}>
          <h3>ثبت کارت فیزیکی</h3>
          <p className={styles.helper}>
            شناسه فقط برای ثبت به Wallet ارسال می‌شود و در پاسخ یا فهرست بعدی به‌صورت کامل نمایش
            داده نخواهد شد.
          </p>
          <form className={styles.formGrid} onSubmit={(event) => void submitRegistration(event)}>
            <label className={styles.field} htmlFor="card-inventory-physical-id">
              شناسه‌ی فیزیکی کارت
              <input
                id="card-inventory-physical-id"
                autoComplete="off"
                dir="ltr"
                required
                disabled={registrationBusy}
                maxLength={160}
                value={registrationDraft.externalCardId}
                onChange={(event) => {
                  const externalCardId = event.currentTarget.value;
                  setRegistrationDraft((current) => ({
                    ...current,
                    externalCardId,
                  }));
                }}
              />
            </label>
            <label className={styles.field} htmlFor="card-inventory-registration-reason">
              دلیل ثبت
              <textarea
                id="card-inventory-registration-reason"
                required
                disabled={registrationBusy}
                minLength={8}
                maxLength={500}
                value={registrationDraft.reason}
                onChange={(event) => {
                  const reason = event.currentTarget.value;
                  setRegistrationDraft((current) => ({
                    ...current,
                    reason,
                  }));
                }}
              />
            </label>
            <div className={styles.formActions}>
              <Button type="submit" disabled={registrationBusy}>
                {registrationBusy ? 'در حال ثبت…' : 'ثبت در موجودی شعبه'}
              </Button>
              <Button
                type="button"
                tone="ghost"
                disabled={registrationBusy}
                onClick={toggleRegistration}
              >
                انصراف و پاک‌کردن شناسه
              </Button>
            </div>
          </form>
        </Surface>
      )}

      {selectedBranchId && !loading && !loadError && (
        <Surface className={styles.filters}>
          <label className={styles.field} htmlFor="card-inventory-status">
            وضعیت موجودی
            <select
              id="card-inventory-status"
              value={statusFilter}
              disabled={loading || registrationBusy || statusBusy}
              onChange={(event) =>
                setStatusFilter(event.currentTarget.value as 'all' | OperationsCardStatus)
              }
            >
              <option value="all">همه‌ی وضعیت‌ها</option>
              {Object.entries(statusLabels).map(([status, label]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field} htmlFor="card-inventory-search">
            جست‌وجو در شناسه‌های ماسک‌شده‌ی بارگذاری‌شده
            <input
              id="card-inventory-search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          <p className={styles.filterNote}>
            فیلتر متن فقط روی کارت‌های دریافت‌شده در صفحه‌های فعلی اعمال می‌شود.
          </p>
        </Surface>
      )}

      {loading && selectedBranchId && (
        <Surface className={styles.state} role="status">
          در حال دریافت موجودی از Wallet…
        </Surface>
      )}
      {!selectedBranchId && scope.type === 'organization' && !branchError && (
        <Surface className={styles.state}>
          برای مشاهده‌ی موجودی، یک شعبه‌ی مجاز انتخاب کنید.
        </Surface>
      )}
      {loadError && (
        <Surface className={`${styles.state} ${styles.errorBlock}`} role="alert">
          <p>{loadError}</p>
          <Button type="button" tone="ghost" onClick={() => void refresh(false)}>
            تلاش دوباره
          </Button>
        </Surface>
      )}
      {!loading && !loadError && selectedBranchId && visibleCards.length === 0 && (
        <Surface className={styles.state}>
          {cards.length === 0
            ? statusFilter === 'all'
              ? 'در این صفحه کارتی ثبت نشده است.'
              : `در این صفحه برای وضعیت «${statusLabels[statusFilter]}» کارتی وجود ندارد.`
            : 'با جست‌وجوی فعلی در کارت‌های بارگذاری‌شده نتیجه‌ای پیدا نشد.'}
          {canManage && cards.length === 0 && statusFilter === 'all' && !nextCursor && (
            <Button type="button" onClick={() => setRegistrationOpen(true)}>
              ثبت نخستین کارت
            </Button>
          )}
        </Surface>
      )}

      {visibleCards.length > 0 && (
        <div className={styles.cardGrid} role="list" aria-label="فهرست موجودی کارت‌ها">
          {visibleCards.map((card) => {
            const allowedTransitions = allowedNextStatuses(card);
            return (
              <Surface className={styles.card} key={card.id} role="listitem">
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.eyebrow}>شناسه‌ی نمایشی</p>
                    <h3 dir="ltr">{card.maskedIdentifier}</h3>
                  </div>
                  <Badge tone={statusTones[card.status]}>{statusLabels[card.status]}</Badge>
                </div>
                <p className={styles.verification}>
                  وضعیت اتصال فیزیکی: <strong>{verificationLabels[card.verificationStatus]}</strong>
                </p>
                <dl className={styles.metadata}>
                  <div>
                    <dt>نسخه</dt>
                    <dd>{toPersianDigits(card.version)}</dd>
                  </div>
                  <div>
                    <dt>آخرین تغییر موجودی</dt>
                    <dd>{formatDate(card.updatedAt)}</dd>
                  </div>
                </dl>
                {canManage && allowedTransitions.length > 0 && (
                  <>
                    <Button
                      type="button"
                      tone="ghost"
                      aria-expanded={changingCardId === card.id}
                      aria-controls={
                        changingCardId === card.id ? `card-status-form-${card.id}` : undefined
                      }
                      disabled={statusBusy}
                      onClick={() => {
                        setChangingCardId((current) => (current === card.id ? null : card.id));
                        setStatusDraft(emptyStatusDraft);
                        setActionError('');
                      }}
                    >
                      {changingCardId === card.id ? 'بستن تغییر وضعیت' : 'تغییر وضعیت موجودی'}
                    </Button>
                    {changingCardId === card.id && (
                      <form
                        id={`card-status-form-${card.id}`}
                        className={styles.statusForm}
                        onSubmit={(event) => void submitStatusChange(event, card)}
                      >
                        <label className={styles.field} htmlFor={`card-status-${card.id}`}>
                          وضعیت جدید
                          <select
                            id={`card-status-${card.id}`}
                            required
                            disabled={statusBusy}
                            value={statusDraft.status}
                            onChange={(event) => {
                              const status = event.currentTarget.value as StatusDraft['status'];
                              setStatusDraft((current) => ({
                                ...current,
                                status,
                                confirmRetirement: false,
                              }));
                            }}
                          >
                            <option value="">انتخاب وضعیت</option>
                            {allowedTransitions.map((status) => (
                              <option key={status} value={status}>
                                {statusLabels[status]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.field} htmlFor={`card-reason-${card.id}`}>
                          دلیل تغییر
                          <textarea
                            id={`card-reason-${card.id}`}
                            required
                            disabled={statusBusy}
                            minLength={8}
                            maxLength={500}
                            value={statusDraft.reason}
                            onChange={(event) => {
                              const reason = event.currentTarget.value;
                              setStatusDraft((current) => ({
                                ...current,
                                reason,
                              }));
                            }}
                          />
                        </label>
                        {statusDraft.status === 'retired' && (
                          <label className={styles.confirmField}>
                            <input
                              type="checkbox"
                              required
                              disabled={statusBusy}
                              checked={statusDraft.confirmRetirement}
                              onChange={(event) => {
                                const confirmRetirement = event.currentTarget.checked;
                                setStatusDraft((current) => ({
                                  ...current,
                                  confirmRetirement,
                                }));
                              }}
                            />
                            بازنشستگی دائمی و غیرقابل‌بازگشت است؛ تأیید می‌کنم
                          </label>
                        )}
                        <Button
                          type="submit"
                          disabled={statusBusy || changingCardId !== card.id || !statusDraft.status}
                        >
                          {statusBusy ? 'در حال ذخیره…' : 'ثبت تغییر وضعیت'}
                        </Button>
                      </form>
                    )}
                  </>
                )}
                {card.status === 'retired' && (
                  <p className={styles.helper}>
                    کارت بازنشسته شده و امکان بازگرداندن آن وجود ندارد.
                  </p>
                )}
              </Surface>
            );
          })}
        </div>
      )}
      {nextCursor && selectedBranchId && !loadError && (
        <Button
          type="button"
          tone="secondary"
          disabled={loading || loadingMore || registrationBusy || statusBusy}
          onClick={() => void loadMoreCards()}
        >
          {loadingMore ? 'در حال دریافت…' : 'بارگذاری کارت‌های بیشتر'}
        </Button>
      )}

      {lastUpdatedAt !== null && selectedBranchId && (
        <p className={styles.lastUpdated} role="status">
          {stale && 'دریافت تازه موفق نشد؛ داده‌ی زیر ممکن است قدیمی باشد. '}
          آخرین دریافت از Wallet: {formatDate(new Date(lastUpdatedAt).toISOString())}. «تأییدنشده»
          وضعیت اتصال provider را نامشخص می‌داند و معادل آنلاین یا معتبر نیست.
        </p>
      )}
      {selectedBranchId && !loadError && !loading && (
        <HouseholdCardAssignments
          organizationId={scope.organizationId}
          branchId={selectedBranchId}
          cards={cards}
          capabilities={capabilities}
          onSessionExpired={onSessionExpired}
          onChanged={() => void refresh(true)}
        />
      )}
    </section>
  );
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403)
      return 'مجوز عملیات یا تأیید MFA نشست کافی نیست؛ مجوز را بررسی و در صورت درخواست دوباره MFA را تأیید کنید.';
    if (failure.status === 404) return 'کارت یا شعبه پیدا نشد؛ محدوده را تازه‌سازی کنید.';
    if (failure.status === 409)
      return 'وضعیت کارت هم‌زمان تغییر کرده یا شناسه تکراری است؛ فهرست را تازه کنید.';
    if (failure.status === 503)
      return 'Wallet یا یکی از سرویس‌های اعتبارسنجی در دسترس نیست؛ داده‌ی قبلی را تازه فرض نکنید.';
    if (failure.status === 0)
      return 'ارتباط برقرار نشد. اتصال را بررسی و با همان داده دوباره تلاش کنید.';
    return failure.message;
  }
  return 'عملیات موجودی کارت انجام نشد؛ دوباره تلاش کنید.';
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

function appendBranches(current: OperationsBranch[], incoming: OperationsBranch[]) {
  const byId = new Map(current.map((branch) => [branch.id, branch]));
  for (const branch of incoming) byId.set(branch.id, branch);
  return [...byId.values()];
}

function appendCards(current: OperationsCard[], incoming: OperationsCard[]) {
  const byId = new Map(current.map((card) => [card.id, card]));
  for (const card of incoming) byId.set(card.id, card);
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
