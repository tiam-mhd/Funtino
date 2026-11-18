'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Surface } from '@funtino/design-system';
import {
  CustomerApiError,
  getCustomerBranches,
  getCustomerCards,
  getCustomerCardTransactions,
  getCustomerCardLifecycleRequests,
  createCustomerCardLifecycleRequest,
  getCustomerHouseholds,
} from '../lib/customer-api';
import type {
  CustomerBranchSummary,
  CustomerCard,
  CustomerCardTransaction,
  CustomerCardLifecycleRequest,
  CustomerHouseholdSummary,
} from '../lib/customer-api';
import {
  customerCardFreshnessLabel,
  resolveCustomerCardRelations,
} from '../lib/customer-card-presentation';
import { CustomerIcon } from './customer-icons';

type LoadState = 'loading' | 'ready' | 'error';

const cardStatus = {
  active: { label: 'فعال', tone: 'success' as const },
  pending_sync: { label: 'در انتظار همگام‌سازی', tone: 'info' as const },
  blocked: { label: 'مسدود', tone: 'warning' as const },
  unlinked: { label: 'غیرفعال', tone: 'warning' as const },
};

export function CustomerCardsList() {
  const [cards, setCards] = useState<CustomerCard[]>([]);
  const [branches, setBranches] = useState<CustomerBranchSummary[]>([]);
  const [households, setHouseholds] = useState<CustomerHouseholdSummary[]>([]);
  const [branchLookupAvailable, setBranchLookupAvailable] = useState(false);
  const [householdLookupAvailable, setHouseholdLookupAvailable] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [historyCardId, setHistoryCardId] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<CustomerCardTransaction[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [lifecycleRequests, setLifecycleRequests] = useState<Record<string, CustomerCardLifecycleRequest[]>>({});
  const [lifecycleLoaded, setLifecycleLoaded] = useState<Record<string, boolean>>({});
  const [lifecycleCardId, setLifecycleCardId] = useState<string | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<CustomerCardLifecycleRequest['action'] | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleLoadingCardId, setLifecycleLoadingCardId] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const [lifecycleNotice, setLifecycleNotice] = useState('');
  const pendingLifecycleCommand = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadCards = useCallback(async () => {
    setState('loading');
    setError('');

    const [cardsResult, branchesResult, householdsResult] = await Promise.allSettled([
      getCustomerCards(),
      getCustomerBranches(),
      getCustomerHouseholds(),
    ] as const);

    setBranchLookupAvailable(branchesResult.status === 'fulfilled');
    setHouseholdLookupAvailable(householdsResult.status === 'fulfilled');

    if (cardsResult.status === 'rejected') {
      const cause = cardsResult.reason;
      setError(
        cause instanceof CustomerApiError
          ? cause.message
          : 'دریافت کارت‌ها ممکن نشد. اتصال را بررسی و دوباره تلاش کن.',
      );
      setState('error');
      return;
    }

    setCards(cardsResult.value);
    setBranches(branchesResult.status === 'fulfilled' ? branchesResult.value : []);
    setHouseholds(householdsResult.status === 'fulfilled' ? householdsResult.value : []);
    setState('ready');
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const loadHistory = async (card: CustomerCard, cursor?: string, append = false) => {
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryCardId(card.id);
    try {
      const result = await getCustomerCardTransactions({
        householdId: card.householdId,
        cardId: card.id,
        cursor,
      });
      setHistoryItems((current) => append ? [...current, ...result.items] : result.items);
      setHistoryCursor(result.nextCursor);
    } catch (cause) {
      setHistoryError(cause instanceof CustomerApiError
        ? cause.message
        : 'دریافت تاریخچه ممکن نشد. اتصال را بررسی و دوباره تلاش کنید.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadLifecycleRequests = async (card: CustomerCard) => {
    setLifecycleLoadingCardId(card.id);
    setLifecycleError('');
    try {
      const items = await getCustomerCardLifecycleRequests({ householdId: card.householdId, cardId: card.id });
      setLifecycleRequests((current) => ({ ...current, [card.id]: items }));
      setLifecycleLoaded((current) => ({ ...current, [card.id]: true }));
    } catch (cause) {
      setLifecycleError(cause instanceof CustomerApiError ? cause.message : 'دریافت وضعیت درخواست کارت ممکن نشد.');
    } finally {
      setLifecycleLoadingCardId(null);
    }
  };

  const beginLifecycleRequest = (card: CustomerCard, action: CustomerCardLifecycleRequest['action']) => {
    setLifecycleCardId(card.id);
    setLifecycleAction(action);
    setLifecycleReason('');
    setLifecycleError('');
    setLifecycleNotice('');
    pendingLifecycleCommand.current = null;
    void loadLifecycleRequests(card);
  };

  const submitLifecycleRequest = async (event: FormEvent<HTMLFormElement>, card: CustomerCard) => {
    event.preventDefault();
    if (!lifecycleAction || lifecycleReason.trim().length < 8 || lifecycleBusy) return;
    const fingerprint = `${card.id}:${lifecycleAction}:${lifecycleReason.trim()}`;
    if (pendingLifecycleCommand.current?.fingerprint !== fingerprint) {
      pendingLifecycleCommand.current = { fingerprint, key: crypto.randomUUID() };
    }
    setLifecycleBusy(true);
    setLifecycleError('');
    setLifecycleNotice('');
    try {
      const result = await createCustomerCardLifecycleRequest({
        householdId: card.householdId,
        cardId: card.id,
        action: lifecycleAction,
        reason: lifecycleReason.trim(),
        idempotencyKey: pendingLifecycleCommand.current.key,
      });
      setLifecycleRequests((current) => ({
        ...current,
        [card.id]: [result, ...(current[card.id] ?? []).filter((item) => item.id !== result.id)],
      }));
      setLifecycleNotice('درخواست ثبت شد؛ پس از بررسی شعبه، وضعیت همین‌جا به‌روزرسانی می‌شود.');
      pendingLifecycleCommand.current = null;
      setLifecycleAction(null);
      setLifecycleReason('');
    } catch (cause) {
      setLifecycleError(cause instanceof CustomerApiError ? cause.message : 'ثبت درخواست انجام نشد؛ دوباره تلاش کنید.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  return (
    <section className="customer-cards-page" aria-labelledby="customer-cards-title">
      <header className="customer-cards-page__header">
        <h1 id="customer-cards-title">کارت‌های خانواده</h1>
        <button
          className="customer-cards-refresh"
          type="button"
          onClick={() => void loadCards()}
          disabled={state === 'loading'}
          aria-label={state === 'error' ? 'تلاش دوباره برای دریافت کارت‌ها' : 'به‌روزرسانی کارت‌ها'}
        >
          {state === 'loading'
            ? 'در حال دریافت…'
            : state === 'error'
              ? 'تلاش دوباره'
              : 'به‌روزرسانی'}
        </button>
      </header>

      {state === 'loading' && (
        <div className="customer-cards-feedback" role="status" aria-live="polite">
          <span className="customer-auth-spinner" aria-hidden="true" />
          <p>در حال دریافت کارت‌های خانواده…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="customer-cards-feedback customer-cards-feedback--error" role="alert">
          <CustomerIcon name="help" size={26} />
          <h2>کارت‌ها بارگذاری نشدند</h2>
          <p>{error}</p>
        </div>
      )}

      {state === 'ready' && cards.length === 0 && (
        <div className="customer-cards-feedback customer-cards-feedback--empty">
          <span className="customer-cards-empty-icon" aria-hidden="true">
            <CustomerIcon name="card" size={30} />
          </span>
          <h2>هنوز کارتی به خانواده تخصیص داده نشده</h2>
          <p>پس از ثبت تخصیص کارت، کارت و وضعیت تأییدشده‌ی آن در همین صفحه نمایش داده می‌شود.</p>
        </div>
      )}

      {state === 'ready' && cards.length > 0 && (
        <>
          {(!branchLookupAvailable || !householdLookupAvailable) && (
            <p className="customer-cards-partial" role="status">
              {!branchLookupAvailable && !householdLookupAvailable
                ? 'اطلاعات شعبه و عضو موقتاً در دسترس نیست؛ جزئیات نامشخص به‌عنوان داده‌ی معتبر نمایش داده نمی‌شود.'
                : !branchLookupAvailable
                  ? 'اطلاعات شعبه موقتاً در دسترس نیست؛ نام شعبه حدس زده نمی‌شود.'
                  : 'اطلاعات عضو موقتاً در دسترس نیست؛ نام عضو حدس زده نمی‌شود.'}
            </p>
          )}
          <div className="customer-cards-list" aria-label="کارت‌های تخصیص‌یافته">
            {cards.map((card) => {
              const status = cardStatus[card.status];
              const relations = resolveCustomerCardRelations(card, households, branches, {
                households: householdLookupAvailable,
                branches: branchLookupAvailable,
              });
              const household = households.find((item) => item.id === card.householdId);
              const member = card.memberId ? household?.members.find((item) => item.id === card.memberId) : null;
              const historyOpen = historyCardId === card.id;
              const lifecycleOpen = lifecycleCardId === card.id;
              const cardLifecycleRequests = lifecycleRequests[card.id] ?? [];
              const hasOpenLifecycleRequest = cardLifecycleRequests.some((item) =>
                item.status === 'requested' || item.status === 'in_review' || item.status === 'approved');

              return (
                <Surface className="customer-owned-card" key={card.id}>
                  <div className="customer-owned-card__top">
                    <span className="customer-owned-card__icon" aria-hidden="true">
                      <CustomerIcon name="card" size={21} />
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="customer-owned-card__number" dir="ltr">
                    {card.maskedCardId}
                  </div>
                  <dl className="customer-owned-card__details">
                    <div>
                      <dt>شعبه</dt>
                      <dd>
                        {relations.branchName}
                        {relations.branchStatus && <small>{relations.branchStatus}</small>}
                      </dd>
                    </div>
                    <div>
                      <dt>خانواده</dt>
                      <dd>{relations.householdName}</dd>
                    </div>
                    <div>
                      <dt>نوع کارت</dt>
                      <dd>{card.memberId ? `اختصاصی ${member?.displayName ?? 'عضو ثبت‌شده'}` : 'مشترک خانواده'}</dd>
                    </div>
                    <div>
                      <dt>تازگی اطلاعات</dt>
                      <dd>{customerCardFreshnessLabel(card)}</dd>
                    </div>
                    <div>
                      <dt>موجودی تأییدشده</dt>
                      <dd>
                        {card.freshness === 'fresh' && card.balanceRial !== null
                          ? `${formatRial(card.balanceRial)} ریال`
                          : 'موجودی فعلی در دسترس نیست'}
                      </dd>
                    </div>
                  </dl>
                  <p className="customer-owned-card__note">
                    {card.lastSyncedAt && Number.isFinite(Date.parse(card.lastSyncedAt))
                      ? `آخرین همگام‌سازی: ${formatDate(card.lastSyncedAt)}`
                      : 'زمان آخرین همگام‌سازی معتبر ثبت نشده است.'}
                  </p>
                  <button
                    className="customer-cards-refresh"
                    type="button"
                    aria-expanded={historyOpen}
                    aria-controls={`card-history-${card.id}`}
                    disabled={historyLoading && historyOpen}
                    onClick={() => {
                      if (historyOpen) {
                        setHistoryCardId(null);
                        setHistoryError('');
                      } else {
                        setHistoryItems([]);
                        setHistoryCursor(null);
                        void loadHistory(card);
                      }
                    }}
                  >
                    {historyOpen ? 'بستن تاریخچه' : 'نمایش تاریخچه تراکنش‌ها'}
                  </button>
                  {historyOpen && (
                    <section id={`card-history-${card.id}`} aria-label={`تاریخچه کارت ${card.maskedCardId}`}>
                      {historyLoading && <p role="status">در حال دریافت تراکنش‌ها…</p>}
                      {historyError && <div role="alert"><p>{historyError}</p><button type="button" onClick={() => void loadHistory(card)}>تلاش دوباره</button></div>}
                      {!historyLoading && !historyError && historyItems.length === 0 && <p>تراکنشی برای این کارت ثبت نشده است.</p>}
                      {historyItems.length > 0 && (
                        <ol>
                          {historyItems.map((transaction) => (
                            <li key={transaction.id}>
                              <strong>{transactionKindLabel(transaction.transactionKind)}</strong>
                              <span>{formatDate(transaction.occurredAt)}</span>
                              <span>{transaction.netAmountRial === null ? 'مبلغ نامشخص' : `${formatRial(transaction.netAmountRial)} ریال`}</span>
                              {transaction.discountAmountRial !== null && transaction.discountAmountRial > 0 &&
                                <span>تخفیف {formatRial(transaction.discountAmountRial)} ریال</span>}
                              {transaction.reversalOfEntryId && <span>ارجاع به تراکنش پیشین</span>}
                              <span>{transaction.deviceName ?? 'نام دستگاه ثبت نشده'}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {historyCursor && !historyLoading && <button type="button" onClick={() => void loadHistory(card, historyCursor, true)}>تراکنش‌های بیشتر</button>}
                    </section>
                  )}
                  <section className="customer-card-lifecycle" aria-label={`درخواست‌های کارت ${card.maskedCardId}`}>
                    <h2>مفقودی یا تعویض کارت</h2>
                    <button
                      type="button"
                      aria-expanded={lifecycleOpen}
                      aria-controls={`card-lifecycle-${card.id}`}
                      onClick={() => {
                        if (lifecycleOpen) {
                          setLifecycleCardId(null);
                          setLifecycleAction(null);
                        } else {
                          setLifecycleCardId(card.id);
                          setLifecycleError('');
                          setLifecycleNotice('');
                          if (!lifecycleLoaded[card.id]) void loadLifecycleRequests(card);
                        }
                      }}
                    >
                      {lifecycleOpen ? 'بستن درخواست‌ها' : 'مشاهده درخواست‌ها'}
                    </button>
                    {lifecycleLoaded[card.id] && card.status === 'active' && !hasOpenLifecycleRequest && (
                      <div className="customer-card-lifecycle__actions">
                        <button type="button" onClick={() => beginLifecycleRequest(card, 'lost')} disabled={lifecycleBusy || lifecycleLoadingCardId === card.id}>
                          گزارش مفقودی
                        </button>
                        <button type="button" onClick={() => beginLifecycleRequest(card, 'replacement')} disabled={lifecycleBusy || lifecycleLoadingCardId === card.id}>
                          درخواست تعویض
                        </button>
                      </div>
                    )}
                    {hasOpenLifecycleRequest && <p role="status">برای این کارت یک درخواست در حال بررسی وجود دارد.</p>}
                    {lifecycleOpen && (
                      <div id={`card-lifecycle-${card.id}`} className="customer-card-lifecycle__panel">
                        {lifecycleLoadingCardId === card.id && <p role="status">در حال دریافت وضعیت درخواست‌ها…</p>}
                        {lifecycleError && <div role="alert"><p>{lifecycleError}</p><button type="button" onClick={() => void loadLifecycleRequests(card)}>تلاش دوباره</button></div>}
                        {lifecycleNotice && <p role="status">{lifecycleNotice}</p>}
                        {lifecycleAction && (
                            <form onSubmit={(event) => void submitLifecycleRequest(event, card)}>
                            <p>{lifecycleAction === 'lost' ? 'گزارش کارت مفقودی' : 'درخواست صدور کارت جایگزین'}</p>
                            <label htmlFor={`lifecycle-reason-${card.id}`}>توضیح برای بررسی شعبه</label>
                            <textarea
                              id={`lifecycle-reason-${card.id}`}
                              value={lifecycleReason}
                              onChange={(event) => setLifecycleReason(event.currentTarget.value)}
                              minLength={8}
                              maxLength={500}
                              required
                                disabled={lifecycleBusy || lifecycleLoadingCardId === card.id}
                            />
                            <button type="submit" disabled={lifecycleBusy || lifecycleLoadingCardId === card.id || lifecycleReason.trim().length < 8}>
                              {lifecycleBusy ? 'در حال ثبت…' : 'ثبت درخواست'}
                            </button>
                          </form>
                        )}
                        {cardLifecycleRequests.length > 0 && (
                          <ol>
                            {cardLifecycleRequests.map((item) => (
                              <li key={item.id}>
                                <strong>{item.action === 'lost' ? 'گزارش مفقودی' : 'درخواست تعویض'} · {lifecycleStatusLabel(item.status)}</strong>
                                <span>{formatDate(item.createdAt)}</span>
                                <p>{item.reason}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                        {lifecycleLoadingCardId !== card.id && !lifecycleError && cardLifecycleRequests.length === 0 && !lifecycleAction &&
                          <p>درخواستی برای این کارت ثبت نشده است.</p>}
                      </div>
                    )}
                  </section>
                </Surface>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function lifecycleStatusLabel(status: CustomerCardLifecycleRequest['status']) {
  const labels: Record<CustomerCardLifecycleRequest['status'], string> = {
    requested: 'ثبت‌شده',
    in_review: 'در حال بررسی',
    approved: 'تأییدشده',
    rejected: 'ردشده',
    completed: 'انجام‌شده',
  };
  return labels[status];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatRial(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

function transactionKindLabel(value: CustomerCardTransaction['transactionKind']): string {
  const labels: Record<CustomerCardTransaction['transactionKind'], string> = {
    top_up: 'شارژ',
    spend: 'مصرف',
    refund: 'بازگشت وجه',
    adjustment: 'اصلاح ثبت‌شده',
    issuance: 'صدور کارت',
    card_replacement: 'تعویض کارت',
  };
  return labels[value];
}
