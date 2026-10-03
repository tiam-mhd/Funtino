'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Surface } from '@funtino/design-system';
import {
  CustomerApiError,
  getCustomerBranches,
  getCustomerCards,
  getCustomerHouseholds,
} from '../lib/customer-api';
import type {
  CustomerBranchSummary,
  CustomerCard,
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
                      <dt>تازگی اطلاعات</dt>
                      <dd>{customerCardFreshnessLabel(card)}</dd>
                    </div>
                  </dl>
                  <p className="customer-owned-card__note">
                    {card.lastSyncedAt && Number.isFinite(Date.parse(card.lastSyncedAt))
                      ? `آخرین همگام‌سازی: ${formatDate(card.lastSyncedAt)}`
                      : 'زمان آخرین همگام‌سازی معتبر ثبت نشده است.'}
                  </p>
                </Surface>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
