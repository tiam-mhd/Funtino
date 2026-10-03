'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  assignOperationsCard,
  cancelOperationsCardAssignment,
  listOperationsCardAssignments,
  lookupOperationsHouseholds,
  transferOperationsCard,
  type OperationsCard,
  type OperationsCardAssignment,
  type OperationsCardCapabilities,
  type OperationsHouseholdMatch,
} from '../../lib/api/operations-cards';
import { normalizePhone } from '../../lib/auth/operations-access';
import styles from './HouseholdCardAssignments.module.css';

type Props = {
  organizationId: string;
  branchId: string;
  cards: OperationsCard[];
  capabilities: OperationsCardCapabilities;
  onSessionExpired: () => void;
  onChanged: () => void;
};

type Mode = 'assign' | 'transfer' | 'cancel' | null;

export function HouseholdCardAssignments({
  organizationId,
  branchId,
  cards,
  capabilities,
  onSessionExpired,
  onChanged,
}: Props) {
  const [items, setItems] = useState<OperationsCardAssignment[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [target, setTarget] = useState<OperationsCardAssignment | null>(null);
  const [cardId, setCardId] = useState('');
  const [phone, setPhone] = useState('');
  const [matches, setMatches] = useState<OperationsHouseholdMatch[]>([]);
  const [householdId, setHouseholdId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const lastCommand = useRef<{ fingerprint: string; key: string } | null>(null);

  const availableCards = useMemo(
    () =>
      cards.filter((card) => card.status === 'in_stock' && card.verificationStatus === 'verified'),
    [cards],
  );

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setStale(true);
    setLoading(true);
    setError('');
    try {
      const page = await listOperationsCardAssignments(organizationId, branchId);
      if (currentRequest !== requestId.current) return;
      setItems(page.items);
      setStale(false);
    } catch (failure) {
      if (currentRequest !== requestId.current) return;
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setError(messageFor(failure));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [branchId, onSessionExpired, organizationId]);

  useEffect(() => {
    setItems([]);
    setStale(false);
    setMode(null);
    setTarget(null);
    setMatches([]);
    setHouseholdId('');
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  function begin(nextMode: Exclude<Mode, null>, assignment?: OperationsCardAssignment) {
    setMode(nextMode);
    setTarget(assignment ?? null);
    setCardId(availableCards[0]?.id ?? '');
    setPhone('');
    setMatches([]);
    setHouseholdId('');
    setReason('');
    setConfirmCancel(false);
    setError('');
    setNotice('');
    lastCommand.current = null;
  }

  async function searchHouseholdsNow() {
    if (!capabilities.canLookupCustomer || phone.trim().length < 8) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const exactPhone = normalizePhone(phone);
      if (!/^\+?[1-9]\d{7,14}$/.test(exactPhone)) {
        setError('شماره‌ی موبایل معتبر نیست.');
        return;
      }
      const result = await lookupOperationsHouseholds(organizationId, branchId, exactPhone);
      setMatches(result.items);
      setHouseholdId(result.items[0]?.householdId ?? '');
      if (result.items.length === 0) setNotice('برای این شماره خانواده‌ی فعالی پیدا نشد.');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || busy || reason.trim().length < 8) return;
    if (
      mode !== 'cancel' &&
      (!householdId || !matches.some((match) => match.householdId === householdId))
    ) {
      setError('ابتدا شماره‌ی دقیق مشتری را بررسی و خانواده را انتخاب کنید.');
      return;
    }
    if (mode === 'assign' && !availableCards.some((card) => card.id === cardId)) {
      setError('فقط کارت تأییدشده و موجود در همین شعبه قابل تخصیص است.');
      return;
    }
    if (mode === 'cancel' && !confirmCancel) {
      setError('برای لغو تخصیص، تأیید نهایی را علامت بزنید.');
      return;
    }

    const payload =
      mode === 'cancel'
        ? { reason: reason.trim() }
        : { phone: normalizePhone(phone), householdId, reason: reason.trim() };
    const fingerprint = JSON.stringify([mode, branchId, target?.id ?? cardId, payload]);
    const key =
      lastCommand.current?.fingerprint === fingerprint
        ? lastCommand.current.key
        : crypto.randomUUID();
    lastCommand.current = { fingerprint, key };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'assign') {
        const card = availableCards.find((item) => item.id === cardId);
        if (!card) throw new Error('کارت برای تخصیص در دسترس نیست.');
        await assignOperationsCard(
          card,
          payload as { phone: string; householdId: string; reason: string },
          key,
        );
        setNotice('کارت به خانواده‌ی انتخاب‌شده در همین شعبه تخصیص یافت.');
      } else if (mode === 'transfer' && target) {
        await transferOperationsCard(
          target,
          payload as { phone: string; householdId: string; reason: string },
          key,
        );
        setNotice('تخصیص کارت به‌صورت اتمیک به خانواده‌ی جدید منتقل شد.');
      } else if (mode === 'cancel' && target) {
        await cancelOperationsCardAssignment(target, payload, key);
        setNotice('تخصیص لغو شد؛ بازگشت کارت به موجودی فقط طبق وضعیت تأیید فیزیکی انجام می‌شود.');
      }
      lastCommand.current = null;
      setMode(null);
      setTarget(null);
      await refresh();
      onChanged();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="household-card-assignments-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>تخصیص مستقل در هر شعبه</p>
          <h2 id="household-card-assignments-title">کارت‌های خانواده‌های این شعبه</h2>
          <p className={styles.helper}>
            هر خانواده در هر شعبه حداکثر یک کارت فعال دارد. کارت مشترک خانواده است، نه کارت یک عضو؛
            انتقال بین اعضا یا شعبه‌ها در این جریان انجام نمی‌شود.
          </p>
        </div>
        <Button type="button" tone="ghost" disabled={loading} onClick={() => void refresh()}>
          تازه‌سازی
        </Button>
      </header>

      {(capabilities.canAssign || capabilities.canLookupCustomer) && (
        <Button
          type="button"
          disabled={
            stale ||
            !capabilities.canAssign ||
            !capabilities.canLookupCustomer ||
            availableCards.length === 0
          }
          onClick={() => begin('assign')}
        >
          تخصیص کارت به خانواده
        </Button>
      )}
      {capabilities.canAssign && availableCards.length === 0 && (
        <p className={styles.helper} role="status">
          فعلاً کارت هم‌زمان «تأییدشده توسط سامانه‌ی فیزیکی» و «موجود در این شعبه» نیست؛ تخصیص باز
          نمی‌شود.
        </p>
      )}

      {mode && (
        <Surface className={styles.formPanel} aria-labelledby="assignment-action-title">
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <h3 id="assignment-action-title">
              {mode === 'assign'
                ? 'تخصیص کارت'
                : mode === 'transfer'
                  ? 'انتقال به خانواده‌ی دیگر'
                  : 'لغو تخصیص کارت'}
            </h3>
            {mode === 'assign' && (
              <label className={styles.field} htmlFor="assignment-card-select">
                کارت تأییدشده
                <select
                  id="assignment-card-select"
                  required
                  value={cardId}
                  onChange={(event) => setCardId(event.currentTarget.value)}
                >
                  {availableCards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.maskedIdentifier}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode !== 'cancel' ? (
              <>
                <fieldset className={styles.lookup}>
                  <legend>یافتن خانواده با شماره‌ی تأییدشده</legend>
                  <label className={styles.field} htmlFor="assignment-customer-phone">
                    شماره‌ی موبایل مشتری
                    <input
                      id="assignment-customer-phone"
                      autoComplete="tel"
                      dir="ltr"
                      inputMode="tel"
                      type="tel"
                      value={phone}
                      onChange={(event) => {
                        setPhone(event.currentTarget.value);
                        setMatches([]);
                        setHouseholdId('');
                      }}
                      required
                    />
                  </label>
                  <Button
                    type="button"
                    tone="secondary"
                    disabled={busy || !capabilities.canLookupCustomer || phone.trim().length < 8}
                    onClick={() => void searchHouseholdsNow()}
                  >
                    {busy ? 'در حال بررسی…' : 'بررسی شماره'}
                  </Button>
                </fieldset>
                {matches.length > 0 && (
                  <label className={styles.field} htmlFor="assignment-household-select">
                    خانواده‌ی تأییدشده
                    <select
                      id="assignment-household-select"
                      value={householdId}
                      onChange={(event) => setHouseholdId(event.currentTarget.value)}
                      required
                    >
                      {matches.map((match) => (
                        <option key={match.householdId} value={match.householdId}>
                          {match.householdName} · {match.activeMemberCount} عضو فعال ·{' '}
                          {match.maskedPhone}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <label className={styles.confirm}>
                <input
                  type="checkbox"
                  checked={confirmCancel}
                  onChange={(event) => setConfirmCancel(event.currentTarget.checked)}
                />
                لغو این تخصیص در شعبه‌ی جاری را تأیید می‌کنم.
              </label>
            )}
            <label className={styles.field} htmlFor="assignment-reason">
              دلیل ثبت‌شونده در audit
              <textarea
                id="assignment-reason"
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                minLength={8}
                maxLength={500}
                required
              />
            </label>
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
            <div className={styles.actions}>
              <Button type="submit" disabled={busy || stale || (mode !== 'cancel' && !householdId)}>
                {busy ? 'در حال ثبت…' : 'ثبت عملیات'}
              </Button>
              <Button type="button" tone="ghost" disabled={busy} onClick={() => setMode(null)}>
                انصراف
              </Button>
            </div>
          </form>
        </Surface>
      )}

      {error && !mode && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && !mode && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {stale && items.length > 0 && !loading && (
        <p className={styles.helper} role="status">
          فهرست تخصیص تازه نشد؛ داده‌ی نمایش‌داده‌شده ممکن است قدیمی باشد و عملیات تغییر تا
          تازه‌سازی موفق غیرفعال است.
        </p>
      )}
      {loading ? (
        <p className={styles.helper} role="status" aria-live="polite">
          در حال دریافت تخصیص‌های این شعبه…
        </p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>در این شعبه تخصیص فعال کارت ثبت نشده است.</p>
      ) : (
        <div className={styles.list} role="list" aria-label="تخصیص‌های کارت خانواده‌ها">
          {items.map((item) => (
            <Surface className={styles.item} role="listitem" key={item.id}>
              <div className={styles.itemHeader}>
                <div>
                  <strong dir="ltr">{item.maskedIdentifier}</strong>
                  <small>شناسه‌ی خانواده: {item.householdId.slice(0, 8)}…</small>
                </div>
                <Badge tone={item.status === 'assigned' ? 'success' : 'warning'}>
                  {item.status === 'assigned' ? 'فعال' : 'نیازمند بررسی وضعیت کارت'}
                </Badge>
              </div>
              <p className={styles.helper}>
                تخصیص از {formatDate(item.assignedAt)} · فقط برای شعبه‌ی فعلی
                {item.status !== 'assigned'
                  ? ' · وضعیت کارت مانع استفاده است و لغو آن به‌تنهایی کارت را آزاد نمی‌کند.'
                  : ''}
              </p>
              <div className={styles.actions}>
                {capabilities.canTransfer &&
                  capabilities.canLookupCustomer &&
                  item.status === 'assigned' && (
                    <Button
                      type="button"
                      tone="secondary"
                      disabled={busy || stale}
                      onClick={() => begin('transfer', item)}
                    >
                      انتقال به خانواده‌ی دیگر
                    </Button>
                  )}
                {capabilities.canUnassign && (
                  <Button
                    type="button"
                    tone="ghost"
                    disabled={busy || stale}
                    onClick={() => begin('cancel', item)}
                  >
                    لغو تخصیص
                  </Button>
                )}
              </div>
            </Surface>
          ))}
        </div>
      )}
    </section>
  );
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 429)
      return 'سهمیه‌ی جست‌وجوی مشتری در این شعبه موقتاً تمام شده است؛ پس از پایان مهلت دوباره تلاش کنید.';
    if (failure.status === 403) return 'مجوز این عملیات در محدوده‌ی شعبه یا تأیید MFA کافی نیست.';
    if (failure.status === 404) return 'کارت، تخصیص یا شعبه‌ی موردنظر پیدا نشد.';
    if (failure.status === 409)
      return 'وضعیت کارت یا تخصیص هم‌زمان تغییر کرده است؛ فهرست را تازه کنید.';
    if (failure.status === 503) return 'یکی از سرویس‌های مالک در دسترس نیست؛ عملیات انجام نشد.';
    return failure.message;
  }
  return failure instanceof Error ? failure.message : 'عملیات تخصیص کارت انجام نشد.';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'زمان نامشخص'
    : new Intl.DateTimeFormat('fa-IR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(date);
}
