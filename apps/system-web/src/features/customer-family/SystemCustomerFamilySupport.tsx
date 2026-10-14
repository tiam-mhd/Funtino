'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  getSystemOrganizationBranches,
  getSystemOrganizations,
  lookupSystemCustomerFamily,
  type SystemBranchOption,
  type SystemFamilyResult,
  type SystemOrganizationOption,
} from '../../lib/api/customer-family';
import styles from './SystemCustomerFamilySupport.module.css';

export function SystemCustomerFamilySupport() {
  const [organizations, setOrganizations] = useState<SystemOrganizationOption[]>([]);
  const [branches, setBranches] = useState<SystemBranchOption[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<SystemFamilyResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void getSystemOrganizations()
      .then((result) => {
        const active = result.filter((organization) => organization.status === 'active');
        setOrganizations(active);
        setOrganizationId('');
      })
      .catch((failure: unknown) => setError(readError(failure)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!organizationId) {
      setBranches([]);
      setBranchId('');
      return;
    }
    let cancelled = false;
    setError('');
    setBranchId('');
    setBranches([]);
    void getSystemOrganizationBranches(organizationId)
      .then((result) => {
        if (cancelled) return;
        const active = result.filter((branch) => branch.status === 'active');
        setBranches(active);
        setBranchId('');
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(readError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError('');
    try {
      const response = await lookupSystemCustomerFamily({
        organizationId,
        branchId,
        phone: phone.trim(),
      });
      setItems(response.items);
    } catch (failure) {
      setItems(null);
      setError(readError(failure));
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span>پشتیبانی سراسری · فقط‌خواندنی</span>
        <h1>مشاهده‌ی خانواده‌ی مشتری</h1>
        <p>
          قبل از جست‌وجو مجموعه و شعبه را انتخاب کن. نتیجه‌ها فقط خانواده‌هایی هستند که کارت فعال
          همان شعبه را دارند.
        </p>
      </header>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
        </div>
      )}
      <Surface className={styles.searchCard} aria-busy={loading || searching}>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>مجموعه‌ی فعال</span>
            <select
              disabled={loading || !organizations.length}
              required
              value={organizationId}
              onChange={(event) => setOrganizationId(event.currentTarget.value)}
            >
              {organizations.length ? (
                organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))
              ) : (
                <option value="">مجموعه‌ای در دسترس نیست</option>
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span>شعبه‌ی فعال</span>
            <select
              disabled={!branches.length}
              required
              value={branchId}
              onChange={(event) => setBranchId(event.currentTarget.value)}
            >
              {branches.length ? (
                branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))
              ) : (
                <option value="">شعبه‌ای انتخاب نشده</option>
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span>شماره‌ی کامل همراه</span>
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
          <Button disabled={loading || searching || !branchId} type="submit">
            {searching ? 'در حال بررسی…' : 'جست‌وجو'}
          </Button>
        </form>
        <p className={styles.privacy}>
          شماره در URL قرار نمی‌گیرد. هر جست‌وجو audit می‌شود و سقف درخواست دارد. این صفحه امکان
          ویرایش، ادغام یا خروجی‌گرفتن ندارد.
        </p>
      </Surface>

      {items !== null && !error && (
        <section className={styles.results} aria-live="polite" aria-label="نتیجه‌ی جست‌وجو">
          {!items.length ? (
            <Surface className={styles.empty}>
              خانواده‌ای با کارت فعال در شعبه‌ی انتخاب‌شده پیدا نشد.
            </Surface>
          ) : (
            items.map((household) => (
              <Surface className={styles.household} key={household.householdId}>
                <div className={styles.householdHeading}>
                  <div>
                    <span>خانواده</span>
                    <h2>{household.householdName}</h2>
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
                            <small>نسبت قدیمی ثبت‌شده: {member.legacyRelationship}</small>
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
                    <h3>دعوت‌های خانواده</h3>
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
                  <h3>تاریخچه‌ی تغییرات</h3>
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
        </section>
      )}
    </main>
  );
}

function invitationStatusLabel(status: SystemFamilyResult['invitations'][number]['status']) {
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

function readError(failure: unknown) {
  if (failure instanceof ApiRequestError && failure.status === 403) {
    return 'مجوز مشاهده‌ی اطلاعات خانواده یا محدوده‌ی سازمان/شعبه وجود ندارد.';
  }
  if (failure instanceof Error && failure.message) return failure.message;
  return 'اتصال به سامانه برقرار نشد. دوباره تلاش کن.';
}
