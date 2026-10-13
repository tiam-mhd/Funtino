'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import type { OperationsScope, OperationsScopeOption } from '../../lib/auth/operations-access';
import { ApiRequestError } from '../../lib/api/client';
import {
  lookupOperationsCustomerFamily,
  type OperationsFamilyResult,
} from '../../lib/api/customer-family-support';
import styles from './CustomerFamilySupport.module.css';

export function CustomerFamilySupport({
  scope,
  scopeOptions,
}: {
  scope: OperationsScope;
  scopeOptions: OperationsScopeOption[];
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
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
    <section className={styles.page} aria-labelledby="customer-family-title">
      <div className={styles.intro}>
        <span>مشاهده‌ی محدود و فقط‌خواندنی</span>
        <h2 id="customer-family-title">اطلاعات خانواده‌ی مشتری</h2>
        <p>
          جست‌وجو فقط با شماره‌ی کامل انجام می‌شود. نتیجه‌ها به خانواده‌هایی محدودند که کارت فعال در
          شعبه‌ی انتخاب‌شده دارند؛ این بخش امکان ویرایش یا خروجی‌گرفتن ندارد.
        </p>
      </div>
      <Surface className={styles.searchCard}>
        <form className={styles.form} onSubmit={submit}>
          {scope.type === 'organization' ? (
            <label className={styles.field}>
              <span>شعبه‌ی مورد بررسی</span>
              <select
                required
                value={branchId}
                onChange={(event) => setBranchId(event.currentTarget.value)}
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
                    <span>خانواده</span>
                    <h3>{household.householdName}</h3>
                  </div>
                  <Badge tone="neutral">{household.members.length} عضو</Badge>
                </div>
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
                {household.invitations.length > 0 && (
                  <section className={styles.invitationHistory} aria-label="وضعیت دعوت‌های خانواده">
                    <h4>دعوت‌های خانواده</h4>
                    <ul className={styles.memberList}>
                      {household.invitations.map((invitation, index) => (
                        <li key={`${invitation.memberName}-${index}`}>
                          <div>
                            <strong>{invitation.memberName}</strong>
                            <span>{invitationStatusLabel(invitation.status)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className={styles.invitationHistory} aria-label="تاریخچه‌ی مجاز خانواده">
                  <h4>تاریخچه‌ی تغییرات</h4>
                  {household.history.length ? (
                    <ul className={styles.memberList}>
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
                  )}
                </section>
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
