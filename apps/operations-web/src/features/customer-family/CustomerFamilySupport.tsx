'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import {
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import { ApiRequestError } from '../../lib/api/client';
import {
  lookupOperationsCustomerFamily,
  type OperationsFamilyResult,
} from '../../lib/api/customer-family-support';
import styles from './CustomerFamilySupport.module.css';

export type CustomerFamilyView = 'lookup' | 'members' | 'invitations' | 'history';

const viewCopy: Record<CustomerFamilyView, { title: string; description: string }> = {
  lookup: {
    title: 'جست‌وجوی خانواده',
    description: 'با شمارهٔ همراه کامل، خانواده‌های قابل مشاهده در محدودهٔ مجاز را پیدا کنید.',
  },
  members: {
    title: 'اعضای خانواده',
    description: 'فقط اعضای خانوادهٔ پیدا‌شده در این فهرست نمایش داده می‌شوند.',
  },
  invitations: {
    title: 'دعوت‌های خانواده',
    description: 'وضعیت دعوت‌های خانوادهٔ پیدا‌شده را جداگانه بررسی کنید.',
  },
  history: {
    title: 'تاریخچهٔ خانواده',
    description: 'تغییرات مجاز ثبت‌شده برای خانوادهٔ پیدا‌شده را جداگانه ببینید.',
  },
};

export function CustomerFamilySupport({
  scope,
  scopeOptions,
  view = 'lookup',
}: {
  scope: OperationsScope;
  scopeOptions: OperationsScopeOption[];
  view?: CustomerFamilyView;
}) {
  const branches = useMemo(
    () =>
      scopeOptions.filter(
        (item) =>
          item.scope.type === 'branch' && item.scope.organizationId === scope.organizationId,
      ),
    [scope.organizationId, scopeOptions],
  );
  const [branchId, setBranchId] = useState(scope.type === 'branch' ? scope.branchId : '');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<OperationsFamilyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const activeScopeKey = scopeKey(scope);

  useEffect(() => {
    setBranchId(scope.type === 'branch' ? scope.branchId : '');
    setItems(null);
  }, [activeScopeKey, scope]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setItems(null);
    try {
      const response = await lookupOperationsCustomerFamily({
        scope,
        branchId,
        phone: phone.trim(),
      });
      setItems(response.items);
    } catch (failure) {
      setError(
        failure instanceof ApiRequestError && failure.status === 429
          ? 'سقف جست‌وجوی این شعبه پر شده است؛ کمی بعد دوباره تلاش کن.'
          : failure instanceof Error
            ? failure.message
            : 'اتصال به سرویس برقرار نشد. دوباره تلاش کن.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="customer-family-title" aria-busy={loading}>
      <div className={styles.intro}>
        <span>مشاهده‌ی محدود و فقط‌خواندنی</span>
        <h2 id="customer-family-title">{viewCopy[view].title}</h2>
        <p>{viewCopy[view].description} این بخش فقط‌خواندنی است و خروجی‌گرفتن ندارد.</p>
      </div>
      <Surface className={styles.searchCard}>
        <form className={styles.form} onSubmit={submit}>
          {scope.type === 'organization' ? (
            <label className={styles.field}>
              <span>شعبه‌ی مورد بررسی</span>
              <select
                required
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.currentTarget.value);
                  setItems(null);
                }}
              >
                <option value="">یک شعبه را انتخاب کن</option>
                {branches.map((branch) => (
                  <option
                    key={branch.scope.type === 'branch' ? branch.scope.branchId : ''}
                    value={branch.scope.type === 'branch' ? branch.scope.branchId : ''}
                  >
                    {branch.branch?.name ?? branch.organization.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className={styles.selectedBranch}>
              <span>شعبه‌ی انتخاب‌شده</span>
              <strong>
                {scopeOptions.find(
                  (item) => item.scope.type === 'branch' && item.scope.branchId === branchId,
                )?.branch?.name ?? 'محدوده‌ی فعلی'}
              </strong>
            </div>
          )}
          <label className={styles.field}>
            <span>شماره‌ی همراه مشتری</span>
            <input
              autoComplete="off"
              dir="ltr"
              inputMode="tel"
              maxLength={20}
              minLength={8}
              onChange={(event) => setPhone(event.currentTarget.value)}
              placeholder="09…"
              required
              value={phone}
            />
          </label>
          <Button disabled={loading || !branchId} type="submit">
            {loading ? 'در حال بررسی…' : 'جست‌وجو'}
          </Button>
        </form>
        <p className={styles.privacy}>
          شماره در URL یا گزارش جست‌وجو ثبت نمی‌شود. هر درخواست در audit ثبت و تعداد آن محدود
          می‌شود.
        </p>
      </Surface>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loading && (
        <div className={styles.loadingState} role="status" aria-live="polite">
          <strong>در حال بررسی دسترسی مجاز خانواده…</strong>
          <span className={styles.loadingSkeleton} aria-hidden="true" />
        </div>
      )}
      {view !== 'lookup' && items === null && !loading && !error && (
        <Surface className={styles.empty} role="status">
          برای دیدن {viewCopy[view].title}، جست‌وجوی خانواده را با محدودهٔ مجاز و شمارهٔ همراه انجام
          دهید.
        </Surface>
      )}
      {items !== null && !error && (
        <div className={styles.results} aria-live="polite">
          {!items.length ? (
            <Surface className={styles.empty}>
              خانواده‌ای با کارت فعال در این شعبه پیدا نشد.
            </Surface>
          ) : (
            items.map((household) => (
              <Surface className={styles.household} key={household.householdId}>
                <div className={styles.householdHeading}>
                  <div>
                    <span>{view === 'lookup' ? 'خانوادهٔ پیدا‌شده' : 'خانواده'}</span>
                    <h3>{household.householdName}</h3>
                  </div>
                  <Badge tone="neutral">
                    {view === 'invitations'
                      ? `${household.invitations.length.toLocaleString('fa-IR')} دعوت`
                      : view === 'history'
                        ? `${household.history.length.toLocaleString('fa-IR')} رویداد`
                        : `${household.members.length.toLocaleString('fa-IR')} عضو`}
                  </Badge>
                </div>
                {view === 'lookup' && (
                  <p className={styles.privacy}>
                    برای مشاهدهٔ جزئیات، صفحهٔ مربوط را از منوی پشتیبانی انتخاب کنید.
                  </p>
                )}
                {view === 'members' &&
                  (household.members.length ? (
                    <ul className={styles.memberList}>
                      {household.members.map((member) => (
                        <li key={member.id}>
                          <div>
                            <strong>{member.displayName}</strong>
                            <span>{member.relationshipLabel}</span>
                            <small>
                              {member.isAccountLinked ? 'حساب فانتینو متصل' : 'بدون حساب متصل'}
                            </small>
                            {member.relationshipStatus === 'needs_review' &&
                              member.legacyRelationship && (
                                <small>نسبت قدیمی: {member.legacyRelationship}</small>
                              )}
                          </div>
                          <Badge tone={member.isDependent ? 'info' : 'neutral'}>
                            {member.isDependent ? 'وابسته' : 'بزرگسال'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.privacy}>عضوی برای نمایش ثبت نشده است.</p>
                  ))}
                {view === 'invitations' &&
                  (household.invitations.length ? (
                    <ul className={styles.memberList} aria-label="دعوت‌های خانواده">
                      {household.invitations.map((invitation, index) => (
                        <li key={`${invitation.memberName}-${index}`}>
                          <div>
                            <strong>{invitation.memberName}</strong>
                            <span>{invitationStatusLabel(invitation.status)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.privacy}>دعوتی برای نمایش ثبت نشده است.</p>
                  ))}
                {view === 'history' &&
                  (household.history.length ? (
                    <ul className={styles.memberList} aria-label="تاریخچهٔ خانواده">
                      {household.history.map((entry, index) => (
                        <li key={`${entry.createdAt}-${index}`}>
                          <div>
                            <strong>{familyHistoryLabel(entry.action)}</strong>
                            <span>{formatHistoryDate(entry.createdAt)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.privacy}>تغییری برای نمایش ثبت نشده است.</p>
                  ))}
              </Surface>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function invitationStatusLabel(status: OperationsFamilyResult['invitations'][number]['status']) {
  const labels: Record<typeof status, string> = {
    pending: 'در انتظار پاسخ',
    accepted: 'پذیرفته‌شده',
    declined: 'ردشده',
    revoked: 'لغوشده',
    expired: 'منقضی‌شده',
    claim_pending: 'در انتظار تأیید سرپرست',
    linked: 'حساب متصل',
    conflict_review: 'نیازمند بررسی',
  };
  return labels[status];
}

function familyHistoryLabel(action: string) {
  const labels: Record<string, string> = {
    'customer.family.member.created': 'عضو خانواده ثبت شد',
    'customer.family.member.updated': 'اطلاعات عضو خانواده ویرایش شد',
    'customer.family.member.archived': 'عضو خانواده بایگانی شد',
    'customer.family.relationship.removed': 'نسبت خانوادگی حذف شد',
    'customer.family.invitation.accepted': 'دعوت پذیرفته شد',
    'customer.family.invitation.expired': 'دعوت منقضی شد',
    'customer.family.account.linked': 'حساب به عضو متصل شد',
    'customer.family.invitation.conflict_review': 'اتصال حساب به بررسی نیاز دارد',
    'customer.family.dependent_claim.approved': 'اتصال حساب وابسته تأیید شد',
    'customer.family.invitation.declined': 'دعوت رد شد',
    'customer.family.invitation.revoked': 'دعوت لغو شد',
    'customer.family.invitation.duplicate_member': 'عضو موجود شناسایی شد',
  };
  return labels[action] ?? 'تغییر خانواده ثبت شد';
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
