'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  getOperationsEdgeSyncStatus,
  replayOperationsEdgeDeadLetter,
  type OperationsEdgeSyncStatus,
} from '../../lib/api/operations-devices';
import styles from './EdgeSyncDashboard.module.css';

type Props = {
  organizationId: string;
  branchId: string;
  canReplay: boolean;
  onSessionExpired: () => void;
};

export function EdgeSyncDashboard({ organizationId, branchId, canReplay, onSessionExpired }: Props) {
  const [status, setStatus] = useState<OperationsEdgeSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [replayDraft, setReplayDraft] = useState<{ eventId: string; reason: string } | null>(null);
  const [replayBusyEventId, setReplayBusyEventId] = useState<string | null>(null);
  const replayAttempt = useRef(new Map<string, { reason: string; key: string }>());
  const requestVersion = useRef(0);
  const statusRef = useRef<OperationsEdgeSyncStatus | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    setStale(statusRef.current !== null);
    setLoadError('');
    try {
      const result = await getOperationsEdgeSyncStatus(organizationId, branchId);
      if (version !== requestVersion.current) return;
      statusRef.current = result;
      setStatus(result);
      setStale(false);
    } catch (failure) {
      if (version !== requestVersion.current) return;
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setLoadError(messageFor(failure));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [branchId, onSessionExpired, organizationId]);

  useEffect(() => {
    setStatus(null);
    statusRef.current = null;
    setStale(false);
    setLoadError('');
    setNotice('');
    setReplayDraft(null);
    replayAttempt.current.clear();
    void refresh(false);
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  async function replay(eventId: string) {
    const reason = replayDraft?.eventId === eventId ? replayDraft.reason.trim() : '';
    if (reason.length < 10) {
      setActionError('برای replay، علت بررسی را حداقل در ۱۰ نویسه بنویسید.');
      return;
    }
    const previous = replayAttempt.current.get(eventId);
    const idempotencyKey = previous?.reason === reason ? previous.key : crypto.randomUUID();
    replayAttempt.current.set(eventId, { reason, key: idempotencyKey });
    setReplayBusyEventId(eventId);
    setActionError('');
    setNotice('');
    try {
      await replayOperationsEdgeDeadLetter(organizationId, branchId, eventId, reason, idempotencyKey);
      replayAttempt.current.delete(eventId);
      setReplayDraft(null);
      setNotice('رویداد با همان شناسه دوباره در صف ارسال قرار گرفت.');
      await refresh(true);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setActionError(messageFor(failure));
    } finally {
      setReplayBusyEventId(null);
    }
  }

  return (
    <Surface className={styles.panel} aria-labelledby="edge-sync-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>همگام‌سازی ویندوز</p>
          <h2 id="edge-sync-title">وضعیت نصب‌ها و رویدادها</h2>
          <p className={styles.description}>heartbeat، نسخه snapshot، صف ارسال و رویدادهای نیازمند بررسی این شعبه.</p>
        </div>
        <div className={styles.headerActions}>
          {stale && <Badge tone="warning">داده قبلی</Badge>}
          <Button type="button" tone="secondary" disabled={loading} onClick={() => void refresh(false)}>
            {loading ? 'در حال دریافت…' : 'تازه‌سازی'}
          </Button>
        </div>
      </header>

      {loadError && (
        <div className={styles.error} role="alert">
          <span>{loadError}</span>
          <Button type="button" tone="ghost" disabled={loading} onClick={() => void refresh(false)}>تلاش دوباره</Button>
        </div>
      )}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {actionError && <p className={styles.errorText} role="alert">{actionError}</p>}
      {loading && !status ? (
        <p className={styles.state} role="status">در حال دریافت وضعیت نصب‌ها…</p>
      ) : status?.installations.length ? (
        <>
          <div className={styles.metrics} aria-label="خلاصه صف همگام‌سازی">
            <Metric label="در انتظار ارسال" value={status.pendingCount} />
            <Metric label="صف مرده" value={status.deadLetterCount} />
            {status.walletReview && <Metric label="نیازمند بررسی دفتر" value={status.walletReview.reviewCount} />}
          </div>

          <div className={styles.installations}>
            {status.installations.map((installation) => (
              <article className={styles.installation} key={installation.sourceInstanceId}>
                <div className={styles.installationHeader}>
                  <div>
                    <h3>نصب ویندوز</h3>
                    <code dir="ltr">{installation.sourceInstanceId}</code>
                  </div>
                  <Badge tone={installation.status === 'active' ? 'success' : 'warning'}>
                    {installation.status === 'active' ? 'فعال' : 'غیرفعال'}
                  </Badge>
                </div>
                <dl className={styles.details}>
                  <div><dt>آخرین heartbeat</dt><dd>{formatDate(installation.lastHeartbeatAt)}</dd></div>
                  <div><dt>snapshot</dt><dd>{installation.snapshot?.version ?? 'دریافت نشده'}</dd></div>
                  <div><dt>اعتبار snapshot تا</dt><dd>{formatDate(installation.snapshot?.validUntil ?? null)}</dd></div>
                  <div><dt>آخرین رویداد دریافتی</dt><dd>{formatDate(installation.lastEvent?.receivedAt ?? null)}</dd></div>
                  <div><dt>در صف / مرده</dt><dd>{fa(installation.outbox.pending)} / {fa(installation.outbox.deadLetter)}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          {status.walletReview && (
            <section className={styles.review} aria-labelledby="edge-review-title">
              <h3 id="edge-review-title">رویدادهای دفتر نیازمند بررسی</h3>
              {status.walletReview.reviewCount === 0 ? (
                <p className={styles.state}>رویداد نیازمند بررسی ثبت نشده است.</p>
              ) : (
                <ul className={styles.errorCodes}>
                  {status.walletReview.errorsByCode.map((item) => (
                    <li key={item.errorCode}><code dir="ltr">{item.errorCode}</code><span>{fa(item.count)} رویداد</span></li>
                  ))}
                </ul>
              )}
              <p className={styles.muted}>این رویدادها پیش از اصلاح علت رد در Wallet قابل replay نیستند.</p>
            </section>
          )}

          <section className={styles.deadLetters} aria-labelledby="edge-dead-letter-title">
            <h3 id="edge-dead-letter-title">ارسال‌های ناموفق</h3>
            {status.deadLetters.length === 0 ? (
              <p className={styles.state}>رویداد مرده‌ای در صف ارسال نیست.</p>
            ) : (
              <ul className={styles.eventList}>
                {status.deadLetters.map((event) => (
                  <li className={styles.event} key={event.outboxEventId}>
                    <div className={styles.eventInfo}>
                      <code dir="ltr">{event.eventId ?? 'شناسه رویداد نامعتبر'}</code>
                      <span>نصب: {event.sourceInstanceId ?? 'نامشخص'}</span>
                      <span>تراکنش محلی: {event.localTransactionId ?? 'نامشخص'}</span>
                      <span>خطا: <code dir="ltr">{event.errorCode}</code> · تلاش: {fa(event.attempts)}</span>
                    </div>
                    {canReplay && event.eventId && (
                      <div className={styles.replay}>
                        {replayDraft?.eventId === event.eventId ? (
                          <>
                            <label htmlFor={`edge-replay-reason-${event.eventId}`}>علت بررسی پیش از replay</label>
                            <textarea
                              id={`edge-replay-reason-${event.eventId}`}
                              maxLength={500}
                              minLength={10}
                              value={replayDraft.reason}
                              onChange={(change) => setReplayDraft({ eventId: event.eventId!, reason: change.currentTarget.value })}
                            />
                            <div className={styles.replayActions}>
                              <Button type="button" disabled={replayBusyEventId !== null || replayDraft.reason.trim().length < 10} onClick={() => void replay(event.eventId!)}>
                                {replayBusyEventId === event.eventId ? 'در صف‌گذاری…' : 'تأیید replay'}
                              </Button>
                              <Button type="button" tone="ghost" disabled={replayBusyEventId !== null} onClick={() => setReplayDraft(null)}>انصراف</Button>
                            </div>
                          </>
                        ) : (
                          <Button type="button" tone="secondary" disabled={replayBusyEventId !== null} onClick={() => { setActionError(''); setReplayDraft({ eventId: event.eventId!, reason: '' }); }}>
                            بررسی و replay
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {status.deadLettersTruncated && <p className={styles.muted}>۱۰۰ مورد اخیر نمایش داده شده‌اند؛ شمار کل در خلاصه آمده است.</p>}
          </section>
        </>
      ) : (
        <p className={styles.state}>برای این شعبه نصب ویندوز ثبت نشده است.</p>
      )}
    </Surface>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className={styles.metric}><span>{label}</span><strong>{fa(value)}</strong></div>;
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError && failure.status === 403) return 'برای مشاهده یا اجرای این عملیات در این شعبه مجوز ندارید.';
  if (failure instanceof ApiRequestError && failure.status === 409) return 'رویداد پیش از replay تغییر کرده است. وضعیت را تازه‌سازی و علت را بررسی کنید.';
  return 'وضعیت همگام‌سازی دریافت نشد. اتصال را بررسی و دوباره تلاش کنید.';
}

function formatDate(value: string | null) {
  if (!value) return 'ثبت نشده';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'زمان نامعتبر';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(date);
}

function fa(value: number) { return new Intl.NumberFormat('fa-IR').format(value); }
