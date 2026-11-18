'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  listOperationsCardLifecycleRequests,
  transitionOperationsCardLifecycleRequest,
  type OperationsCardLifecycleRequest,
} from '../../lib/api/operations-cards';
import styles from './CardLifecycleRequests.module.css';

type Status = OperationsCardLifecycleRequest['status'];
type NextStatus = Exclude<Status, 'requested'>;

type Props = {
  organizationId: string;
  branchId: string;
  canManage: boolean;
  onSessionExpired: () => void;
  onChanged: () => void;
};

export function CardLifecycleRequests({ organizationId, branchId, canManage, onSessionExpired, onChanged }: Props) {
  const [items, setItems] = useState<OperationsCardLifecycleRequest[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<Status | ''>('requested');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<OperationsCardLifecycleRequest | null>(null);
  const [nextStatus, setNextStatus] = useState<NextStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const lastCommand = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async (cursor?: string, append = false) => {
    setStale(true);
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const page = await listOperationsCardLifecycleRequests({
        organizationId,
        branchId,
        status: filterStatus || undefined,
        cursor,
      });
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
      setStale(false);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setError(messageFor(failure));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [organizationId, branchId, filterStatus, onSessionExpired]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load();
  }, [load]);

  const beginTransition = (item: OperationsCardLifecycleRequest, status: NextStatus) => {
    setSelected(item);
    setNextStatus(status);
    setReason('');
    setError('');
    setNotice('');
    lastCommand.current = null;
  };

  const submitTransition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !nextStatus || reason.trim().length < 8 || busy) return;
    const fingerprint = `${selected.id}:${nextStatus}:${reason.trim()}`;
    if (lastCommand.current?.fingerprint !== fingerprint)
      lastCommand.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await transitionOperationsCardLifecycleRequest({
        organizationId,
        branchId,
        requestId: selected.id,
        status: nextStatus,
        reason: reason.trim(),
        idempotencyKey: lastCommand.current.key,
      });
      setItems((current) => current.map((item) => item.id === result.id ? { ...item, ...result } : item));
      setNotice('تغییر وضعیت ثبت و برای خانواده ارسال شد.');
      setSelected(null);
      setNextStatus(null);
      setReason('');
      lastCommand.current = null;
      onChanged();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface className={styles.panel} aria-labelledby="card-lifecycle-title">
      <header className={styles.header}>
        <div>
          <h2 id="card-lifecycle-title">درخواست مفقودی و تعویض کارت</h2>
          <p>فقط درخواست‌های شعبه‌ی انتخاب‌شده نمایش داده می‌شوند.</p>
        </div>
        <div className={styles.filters}>
          <label htmlFor="card-lifecycle-status">وضعیت</label>
          <select id="card-lifecycle-status" value={filterStatus} onChange={(event) => setFilterStatus(event.currentTarget.value as Status | '')}>
            <option value="requested">ثبت‌شده</option>
            <option value="in_review">در حال بررسی</option>
            <option value="approved">تأییدشده</option>
            <option value="rejected">ردشده</option>
            <option value="completed">انجام‌شده</option>
            <option value="">همه</option>
          </select>
          <Button type="button" tone="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? 'در حال دریافت…' : 'به‌روزرسانی'}
          </Button>
        </div>
      </header>

      {stale && items.length > 0 && !loading && <p className={styles.stale} role="status">دریافت تازه انجام نشد؛ داده‌های فهرست ممکن است قدیمی باشند.</p>}
      {loading && items.length === 0 && <p className={styles.feedback} role="status">در حال دریافت درخواست‌های شعبه…</p>}
      {error && <div className={styles.error} role="alert"><p>{error}</p><Button type="button" tone="secondary" onClick={() => void load()}>تلاش دوباره</Button></div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!loading && !error && items.length === 0 && <p className={styles.feedback}>درخواستی با این وضعیت ثبت نشده است.</p>}

      {items.length > 0 && (
        <ol className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <div>
                  <strong>{item.action === 'lost' ? 'گزارش مفقودی' : 'درخواست تعویض'}</strong>
                  <span className={styles.masked} dir="ltr">{item.maskedIdentifier}</span>
                </div>
                <Badge tone={item.status === 'approved' || item.status === 'completed' ? 'success' : item.status === 'rejected' ? 'warning' : 'info'}>
                  {statusLabel(item.status)}
                </Badge>
              </div>
              <p className={styles.reason}>{item.reason}</p>
              <small>ثبت {formatDate(item.createdAt)} · خانواده {shortId(item.householdId)}{item.memberId ? ` · عضو ${shortId(item.memberId)}` : ' · کارت مشترک خانواده'}</small>
              {item.replacementCardId && <small>کارت جایگزین به تخصیص تأییدشده‌ی همان عضو پیوند خورده است.</small>}

              {canManage && (
                <div className={styles.actions}>
                  {item.status === 'requested' && <Button type="button" tone="secondary" disabled={busy || stale} onClick={() => beginTransition(item, 'in_review')}>شروع بررسی</Button>}
                  {(item.status === 'requested' || item.status === 'in_review') && (
                    <>
                      <Button type="button" disabled={busy || stale} onClick={() => beginTransition(item, 'approved')}>تأیید</Button>
                      <Button type="button" tone="ghost" disabled={busy || stale} onClick={() => beginTransition(item, 'rejected')}>رد درخواست</Button>
                    </>
                  )}
                  {item.status === 'approved' && <Button type="button" tone="secondary" disabled={busy || stale} onClick={() => beginTransition(item, 'completed')}>ثبت انجام کار</Button>}
                </div>
              )}
              {selected?.id === item.id && nextStatus && (
                <form className={styles.form} onSubmit={(event) => void submitTransition(event)}>
                  {nextStatus === 'approved' && <p className={styles.notice}>با تأیید، کارت قدیمی مسدود می‌شود و از snapshot بعدی شعبه کنار می‌رود.</p>}
                  {nextStatus === 'completed' && item.action === 'replacement' && <p className={styles.notice}>کارت جایگزین باید پیش‌تر در همین شعبه، برای همین عضو یا خانواده، تأیید و تخصیص داده شده باشد.</p>}
                  <label htmlFor={`lifecycle-review-reason-${item.id}`}>دلیل یا توضیح ثبت‌شونده در سابقه</label>
                  <textarea
                    id={`lifecycle-review-reason-${item.id}`}
                    value={reason}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    minLength={8}
                    maxLength={500}
                    required
                    disabled={busy}
                  />
                  <div className={styles.actions}>
                    <Button type="submit" disabled={busy || reason.trim().length < 8}>{busy ? 'در حال ثبت…' : 'ثبت تغییر'}</Button>
                    <Button type="button" tone="ghost" disabled={busy} onClick={() => { setSelected(null); setNextStatus(null); }}>انصراف</Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ol>
      )}

      {nextCursor && !loading && (
        <Button type="button" tone="secondary" disabled={loadingMore || stale} onClick={() => void load(nextCursor, true)}>
          {loadingMore ? 'در حال دریافت…' : 'درخواست‌های بیشتر'}
        </Button>
      )}
    </Surface>
  );
}

function statusLabel(status: Status) {
  const labels: Record<Status, string> = {
    requested: 'ثبت‌شده',
    in_review: 'در حال بررسی',
    approved: 'تأییدشده',
    rejected: 'ردشده',
    completed: 'انجام‌شده',
  };
  return labels[status];
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403) return 'مجوز مدیریت کارت در محدوده‌ی این شعبه کافی نیست.';
    if (failure.status === 404) return 'درخواست یا شعبه پیدا نشد؛ فهرست را تازه کنید.';
    if (failure.status === 409) return 'وضعیت کارت یا درخواست تغییر کرده است؛ فهرست را تازه کنید و علت را بررسی کنید.';
    if (failure.status === 503) return 'یکی از سرویس‌های مالک در دسترس نیست؛ دوباره تلاش کنید.';
    return failure.message;
  }
  return failure instanceof Error ? failure.message : 'درخواست انجام نشد؛ دوباره تلاش کنید.';
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'زمان نامشخص' : new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
