'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  getOperationsEdgeSyncStatus,
  replayOperationsEdgeDeadLetter,
  getOperationsEdgePairingPermissions,
  approveOperationsEdgePairing,
  type OperationsEdgePermission,
  type OperationsEdgeSyncStatus,
} from '../../lib/api/operations-devices';
import styles from './EdgeSyncDashboard.module.css';

type Props = {
  organizationId: string;
  branchId: string;
  canReplay: boolean;
  onSessionExpired: () => void;
};

export function EdgeSyncDashboard({
  organizationId,
  branchId,
  canReplay,
  onSessionExpired,
}: Props) {
  const [status, setStatus] = useState<OperationsEdgeSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pairingPermissions, setPairingPermissions] = useState<OperationsEdgePermission[]>([]);
  const [pairingPermissionsLoading, setPairingPermissionsLoading] = useState(true);
  const [pairingCode, setPairingCode] = useState('');
  const [selectedPairingPermissions, setSelectedPairingPermissions] = useState<
    OperationsEdgePermission[]
  >([]);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [pairingNotice, setPairingNotice] = useState('');
  const [replayDraft, setReplayDraft] = useState<{ eventId: string; reason: string } | null>(null);
  const [replayBusyEventId, setReplayBusyEventId] = useState<string | null>(null);
  const replayAttempt = useRef(new Map<string, { reason: string; key: string }>());
  const pairingAttempt = useRef<{ signature: string; key: string } | null>(null);
  const requestVersion = useRef(0);
  const statusRef = useRef<OperationsEdgeSyncStatus | null>(null);

  const refresh = useCallback(
    async (quiet = false) => {
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
    },
    [branchId, onSessionExpired, organizationId],
  );

  useEffect(() => {
    setStatus(null);
    statusRef.current = null;
    setStale(false);
    setLoadError('');
    setNotice('');
    setReplayDraft(null);
    replayAttempt.current.clear();
    void refresh(false);
    return () => {
      requestVersion.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    setPairingPermissionsLoading(true);
    setPairingPermissions([]);
    setSelectedPairingPermissions([]);
    setPairingCode('');
    setPairingError('');
    setPairingNotice('');
    pairingAttempt.current = null;
    void getOperationsEdgePairingPermissions(branchId)
      .then((result) => {
        if (!active) return;
        if (result.branchId.toLowerCase() !== branchId.toLowerCase()) {
          setPairingError('پاسخ دسترسی با شعبهٔ انتخاب‌شده یکسان نیست.');
          return;
        }
        setPairingPermissions(result.permissionKeys);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        else setPairingError(messageForPairing(failure));
      })
      .finally(() => {
        if (active) setPairingPermissionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [branchId, onSessionExpired]);

  async function approvePairing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = pairingCode.toUpperCase().replace(/[\s-]/gu, '');
    if (!/^[A-HJ-NP-Z2-9]{10}$/u.test(normalizedCode)) {
      setPairingError('کد اتصال باید ده نویسه باشد.');
      return;
    }
    if (!selectedPairingPermissions.length) {
      setPairingError('حداقل یک دسترسی لازم را انتخاب کنید.');
      return;
    }
    const permissions = [...selectedPairingPermissions].sort();
    const signature = [branchId, normalizedCode, permissions.join(',')].join('|');
    const key =
      pairingAttempt.current?.signature === signature
        ? pairingAttempt.current.key
        : crypto.randomUUID();
    pairingAttempt.current = { signature, key };
    setPairingBusy(true);
    setPairingError('');
    setPairingNotice('');
    try {
      const result = await approveOperationsEdgePairing(branchId, normalizedCode, permissions, key);
      if (
        result.branchId.toLowerCase() !== branchId.toLowerCase() ||
        result.permissionKeys.length !== permissions.length ||
        result.permissionKeys.some((permission) => !permissions.includes(permission))
      ) {
        setPairingError('پاسخ تأیید اتصال با درخواست یکسان نیست.');
        return;
      }
      pairingAttempt.current = null;
      setPairingCode('');
      setSelectedPairingPermissions([]);
      setPairingNotice('اتصال تأیید شد. نصب ویندوز پس از دریافت پاسخ، مجوز کوتاه‌مدت را می‌گیرد.');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setPairingError(messageForPairing(failure));
    } finally {
      setPairingBusy(false);
    }
  }

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
      await replayOperationsEdgeDeadLetter(
        organizationId,
        branchId,
        eventId,
        reason,
        idempotencyKey,
      );
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
          <p className={styles.description}>
            heartbeat، نسخه snapshot، صف ارسال و رویدادهای نیازمند بررسی این شعبه.
          </p>
        </div>
        <div className={styles.headerActions}>
          {stale && <Badge tone="warning">داده قبلی</Badge>}
          <Button
            type="button"
            tone="secondary"
            disabled={loading}
            onClick={() => void refresh(false)}
          >
            {loading ? 'در حال دریافت…' : 'تازه‌سازی'}
          </Button>
        </div>
      </header>

      {loadError && (
        <div className={styles.error} role="alert">
          <span>{loadError}</span>
          <Button type="button" tone="ghost" disabled={loading} onClick={() => void refresh(false)}>
            تلاش دوباره
          </Button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className={styles.errorText} role="alert">
          {actionError}
        </p>
      )}
      <section className={styles.pairing} aria-labelledby="edge-pairing-title">
        <div>
          <h3 id="edge-pairing-title">اتصال امن صندوق ویندوز</h3>
          <p className={styles.muted}>
            کد را از پنجرهٔ صندوق بگیرید. فقط دسترسی‌های لازم برای همین شعبه را انتخاب کنید؛ مجوز
            نهایی با سیاست جاری سامانه بررسی می‌شود.
          </p>
        </div>
        {pairingPermissionsLoading ? (
          <p className={styles.state} role="status">
            در حال دریافت دسترسی‌های مجاز این شعبه…
          </p>
        ) : pairingPermissions.length === 0 ? (
          <p className={styles.state}>برای این نشست و شعبه دسترسی مرکزی قابل واگذاری وجود ندارد.</p>
        ) : (
          <form className={styles.pairingForm} onSubmit={(event) => void approvePairing(event)}>
            <label htmlFor="edge-pairing-code">کد اتصال یک‌بارمصرف</label>
            <input
              id="edge-pairing-code"
              autoComplete="off"
              dir="ltr"
              maxLength={16}
              value={pairingCode}
              onChange={(event) => {
                setPairingCode(event.currentTarget.value.toUpperCase());
                setPairingError('');
                pairingAttempt.current = null;
              }}
              aria-describedby="edge-pairing-help"
              disabled={pairingBusy}
            />
            <p id="edge-pairing-help" className={styles.muted}>
              کد پس از پنج دقیقه منقضی می‌شود و فقط یک‌بار قابل استفاده است.
            </p>
            <fieldset disabled={pairingBusy}>
              <legend>دسترسی‌های موردنیاز</legend>
              {pairingPermissions.map((permission) => (
                <label className={styles.permissionChoice} key={permission}>
                  <input
                    type="checkbox"
                    checked={selectedPairingPermissions.includes(permission)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedPairingPermissions((current) =>
                        checked
                          ? [...current, permission]
                          : current.filter((item) => item !== permission),
                      );
                      pairingAttempt.current = null;
                    }}
                  />
                  <span>{permissionLabel(permission)}</span>
                </label>
              ))}
            </fieldset>
            <div className={styles.pairingActions}>
              <Button
                type="submit"
                disabled={
                  pairingBusy ||
                  selectedPairingPermissions.length === 0 ||
                  pairingCode.trim().length < 10
                }
              >
                {pairingBusy ? 'در حال تأیید…' : 'تأیید اتصال'}
              </Button>
              <Button
                type="button"
                tone="ghost"
                disabled={pairingBusy}
                onClick={() => {
                  setPairingCode('');
                  setSelectedPairingPermissions([]);
                  setPairingError('');
                  pairingAttempt.current = null;
                }}
              >
                پاک‌کردن
              </Button>
            </div>
            {pairingError && (
              <p className={styles.errorText} role="alert">
                {pairingError}
              </p>
            )}
            {pairingNotice && (
              <p className={styles.notice} role="status">
                {pairingNotice}
              </p>
            )}
          </form>
        )}
      </section>
      {loading && !status ? (
        <p className={styles.state} role="status">
          در حال دریافت وضعیت نصب‌ها…
        </p>
      ) : status?.installations.length ? (
        <>
          <div className={styles.metrics} aria-label="خلاصه صف همگام‌سازی">
            <Metric label="در انتظار ارسال" value={status.pendingCount} />
            <Metric label="صف مرده" value={status.deadLetterCount} />
            {status.walletReview && (
              <Metric label="نیازمند بررسی دفتر" value={status.walletReview.reviewCount} />
            )}
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
                  <div>
                    <dt>آخرین heartbeat</dt>
                    <dd>{formatDate(installation.lastHeartbeatAt)}</dd>
                  </div>
                  <div>
                    <dt>snapshot</dt>
                    <dd>{installation.snapshot?.version ?? 'دریافت نشده'}</dd>
                  </div>
                  <div>
                    <dt>اعتبار snapshot تا</dt>
                    <dd>{formatDate(installation.snapshot?.validUntil ?? null)}</dd>
                  </div>
                  <div>
                    <dt>آخرین رویداد دریافتی</dt>
                    <dd>{formatDate(installation.lastEvent?.receivedAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>در صف / مرده</dt>
                    <dd>
                      {fa(installation.outbox.pending)} / {fa(installation.outbox.deadLetter)}
                    </dd>
                  </div>
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
                    <li key={item.errorCode}>
                      <code dir="ltr">{item.errorCode}</code>
                      <span>{fa(item.count)} رویداد</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.muted}>
                این رویدادها پیش از اصلاح علت رد در Wallet قابل replay نیستند.
              </p>
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
                      <span>
                        خطا: <code dir="ltr">{event.errorCode}</code> · تلاش: {fa(event.attempts)}
                      </span>
                    </div>
                    {canReplay && event.eventId && (
                      <div className={styles.replay}>
                        {replayDraft?.eventId === event.eventId ? (
                          <>
                            <label htmlFor={`edge-replay-reason-${event.eventId}`}>
                              علت بررسی پیش از replay
                            </label>
                            <textarea
                              id={`edge-replay-reason-${event.eventId}`}
                              maxLength={500}
                              minLength={10}
                              value={replayDraft.reason}
                              onChange={(change) =>
                                setReplayDraft({
                                  eventId: event.eventId!,
                                  reason: change.currentTarget.value,
                                })
                              }
                            />
                            <div className={styles.replayActions}>
                              <Button
                                type="button"
                                disabled={
                                  replayBusyEventId !== null ||
                                  replayDraft.reason.trim().length < 10
                                }
                                onClick={() => void replay(event.eventId!)}
                              >
                                {replayBusyEventId === event.eventId
                                  ? 'در صف‌گذاری…'
                                  : 'تأیید replay'}
                              </Button>
                              <Button
                                type="button"
                                tone="ghost"
                                disabled={replayBusyEventId !== null}
                                onClick={() => setReplayDraft(null)}
                              >
                                انصراف
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Button
                            type="button"
                            tone="secondary"
                            disabled={replayBusyEventId !== null}
                            onClick={() => {
                              setActionError('');
                              setReplayDraft({ eventId: event.eventId!, reason: '' });
                            }}
                          >
                            بررسی و replay
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {status.deadLettersTruncated && (
              <p className={styles.muted}>
                ۱۰۰ مورد اخیر نمایش داده شده‌اند؛ شمار کل در خلاصه آمده است.
              </p>
            )}
          </section>
        </>
      ) : (
        <p className={styles.state}>برای این شعبه نصب ویندوز ثبت نشده است.</p>
      )}
    </Surface>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{fa(value)}</strong>
    </div>
  );
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError && failure.status === 403)
    return 'برای مشاهده یا اجرای این عملیات در این شعبه مجوز ندارید.';
  if (failure instanceof ApiRequestError && failure.status === 409)
    return 'رویداد پیش از replay تغییر کرده است. وضعیت را تازه‌سازی و علت را بررسی کنید.';
  return 'وضعیت همگام‌سازی دریافت نشد. اتصال را بررسی و دوباره تلاش کنید.';
}

function messageForPairing(failure: unknown) {
  if (failure instanceof ApiRequestError && failure.status === 403)
    return 'نشست برای این شعبه یا همهٔ دسترسی‌های انتخاب‌شده مجاز نیست.';
  if (failure instanceof ApiRequestError && failure.status === 404)
    return 'کد اتصال پیدا نشد، منقضی شده یا برای شعبهٔ دیگری ساخته شده است.';
  if (failure instanceof ApiRequestError && failure.status === 409)
    return 'درخواست تکراری با اطلاعات دیگری فرستاده شده است. کد را دوباره بررسی کنید.';
  if (failure instanceof ApiRequestError && failure.status === 429)
    return 'تعداد تلاش‌ها زیاد است. کمی صبر کنید و دوباره تلاش کنید.';
  return 'اتصال تأیید نشد. وضعیت شبکه و نشست مدیریتی را بررسی کنید.';
}

function permissionLabel(permission: OperationsEdgePermission) {
  const labels: Record<OperationsEdgePermission, string> = {
    'card.inventory.read': 'مشاهدهٔ موجودی کارت',
    'card.inventory.manage': 'مدیریت کارت',
    'card.assign': 'اتصال کارت',
    'card.transfer': 'انتقال کارت',
    'card.unassign': 'جداسازی کارت',
    'customer.lookup.limited': 'جست‌وجوی محدود مشتری',
    'customer.provisional.create': 'ثبت مشتری موقت',
    'customer.family.read': 'مشاهدهٔ خانواده',
    'customer.family.manage': 'مدیریت خانواده',
    'customer.profile.manage': 'ویرایش پروندهٔ مشتری',
  };
  return labels[permission];
}

function formatDate(value: string | null) {
  if (!value) return 'ثبت نشده';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'زمان نامعتبر';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}

function fa(value: number) {
  return new Intl.NumberFormat('fa-IR').format(value);
}
