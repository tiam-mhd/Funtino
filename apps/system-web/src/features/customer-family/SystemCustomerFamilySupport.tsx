'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { ManagementListPage } from '../../components/system-shell/ManagementListPage';
import {
  getSystemOrganizationBranches,
  getSystemOrganizations,
  lookupSystemCustomerFamily,
  type SystemBranchOption,
  type SystemFamilyResult,
  type SystemOrganizationOption,
} from '../../lib/api/customer-family';
import styles from './SystemCustomerFamilySupport.module.css';

export type SystemCustomerFamilyView = 'lookup' | 'members' | 'invitations' | 'history';

const viewCopy: Record<SystemCustomerFamilyView, { title: string; description: string }> = {
  lookup: {
    title: 'جست‌وجوی خانواده',
    description:
      'برای جست‌وجو، مجموعه و شعبهٔ فعال را انتخاب کنید. فقط خانواده‌های دارای کارت فعال در همان شعبه نمایش داده می‌شوند.',
  },
  members: {
    title: 'اعضای خانواده',
    description: 'پس از جست‌وجو، فقط اعضای خانوادهٔ پیدا‌شده در این فهرست نمایش داده می‌شوند.',
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

export function SystemCustomerFamilySupport({
  view = 'lookup',
}: {
  view?: SystemCustomerFamilyView;
}) {
  const [organizations, setOrganizations] = useState<SystemOrganizationOption[]>([]);
  const [branches, setBranches] = useState<SystemBranchOption[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<SystemFamilyResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);

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
      setItems(null);
      setBranches([]);
      setBranchId('');
      setBranchesLoading(false);
      return;
    }
    let cancelled = false;
    setError('');
    setItems(null);
    setBranchesLoading(true);
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
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function retryOptions() {
    setError('');
    if (!organizationId) {
      setLoading(true);
      try {
        const result = await getSystemOrganizations();
        setOrganizations(result.filter((organization) => organization.status === 'active'));
      } catch (failure) {
        setError(readError(failure));
      } finally {
        setLoading(false);
      }
      return;
    }
    setBranchesLoading(true);
    try {
      const result = await getSystemOrganizationBranches(organizationId);
      setBranches(result.filter((branch) => branch.status === 'active'));
    } catch (failure) {
      setError(readError(failure));
    } finally {
      setBranchesLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    setSearching(true);
    setError('');
    setItems(null);
    setPageNumber(1);
    try {
      const response = await lookupSystemCustomerFamily({
        organizationId,
        branchId,
        phone: phone.trim(),
      });
      setItems(response.items);
      return true;
    } catch (failure) {
      setItems(null);
      setError(readError(failure));
      return false;
    } finally {
      setSearching(false);
    }
  }

  function clearLookup() {
    setOrganizationId('');
    setBranchId('');
    setPhone('');
    setItems(null);
    setError('');
  }

  const lookupFields = (
    <>
      <label className={styles.field}>
        <span>مجموعه‌ی فعال</span>
        <select
          disabled={loading || !organizations.length}
          required
          value={organizationId}
          onChange={(event) => {
            setOrganizationId(event.currentTarget.value);
            setItems(null);
          }}
        >
          <option value="">
            {loading
              ? 'در حال دریافت مجموعه‌ها…'
              : organizations.length
                ? 'انتخاب مجموعه'
                : 'مجموعه‌ای در دسترس نیست'}
          </option>
          {!loading && organizations.length
            ? organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))
            : null}
        </select>
      </label>
      <label className={styles.field}>
        <span>شعبه‌ی فعال</span>
        <select
          disabled={branchesLoading || !branches.length}
          required
          value={branchId}
          onChange={(event) => {
            setBranchId(event.currentTarget.value);
            setItems(null);
          }}
        >
          <option value="">
            {branchesLoading
              ? 'در حال دریافت شعب…'
              : branches.length
                ? 'انتخاب شعبه'
                : 'شعبه‌ای انتخاب نشده'}
          </option>
          {!branchesLoading && branches.length
            ? branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))
            : null}
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
    </>
  );
  const visibleHouseholds = items?.slice((pageNumber - 1) * 25, pageNumber * 25) ?? [];

  return (
    <main className={styles.page}>
      <ManagementListPage
        eyebrow="پشتیبانی سراسری · فقط‌خواندنی"
        title={viewCopy[view].title}
        description={`${viewCopy[view].description} شمارهٔ تلفن در URL قرار نمی‌گیرد و این ابزار فقط‌خواندنی است.`}
        filterTitle="جست‌وجوی مجاز خانواده"
        filterDescription="محدوده و شماره را برای خواندن محدود و auditشده انتخاب کنید."
        filterFields={view === 'lookup' ? undefined : lookupFields}
        onApplyFilters={view === 'lookup' ? undefined : submit}
        onClearFilters={view === 'lookup' ? undefined : clearLookup}
        appliedFilterCount={view !== 'lookup' && items !== null ? 1 : 0}
        filtersBusy={loading || searching || branchesLoading}
        pagination={
          items === null
            ? undefined
            : {
                page: pageNumber,
                itemCount: visibleHouseholds.length,
                canGoPrevious: pageNumber > 1,
                canGoNext: pageNumber * 25 < items.length,
                busy: searching,
                onPrevious: () => setPageNumber((current) => Math.max(1, current - 1)),
                onNext: () => setPageNumber((current) => current + 1),
              }
        }
      >
        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            {(organizations.length === 0 || (organizationId && branches.length === 0)) && (
              <Button
                type="button"
                tone="ghost"
                onClick={() => void retryOptions()}
                disabled={loading || branchesLoading}
              >
                {loading || branchesLoading ? 'در حال تلاش…' : 'تلاش دوباره'}
              </Button>
            )}
          </div>
        )}
        {view === 'lookup' && (
          <Surface className={styles.searchCard} aria-busy={loading || searching}>
            <form className={styles.form} onSubmit={submit}>
              {lookupFields}
              <Button disabled={loading || searching || !branchId} type="submit">
                {searching ? 'در حال بررسی…' : 'جست‌وجو'}
              </Button>
            </form>
            <p className={styles.privacy}>
              شماره در URL قرار نمی‌گیرد. هر جست‌وجو audit می‌شود و سقف درخواست دارد. این صفحه امکان
              ویرایش، ادغام یا خروجی‌گرفتن ندارد.
            </p>
          </Surface>
        )}

        {view !== 'lookup' && items === null && !searching && !error && (
          <Surface className={styles.empty} role="status">
            برای دیدن {viewCopy[view].title}، جست‌وجوی خانواده را با مجموعه و شعبهٔ مجاز انجام دهید.
          </Surface>
        )}
        {items !== null && !error && (
          <section className={styles.results} aria-live="polite" aria-label={viewCopy[view].title}>
            <div className={styles.resultsHeading}>
              <div>
                <h2>{view === 'lookup' ? 'نتیجهٔ جست‌وجو' : viewCopy[view].title}</h2>
                <p>
                  {organizations.find((item) => item.id === organizationId)?.name ?? 'مجموعه'}
                  {' · '}
                  {branches.find((item) => item.id === branchId)?.name ?? 'شعبه'}
                </p>
              </div>
              <Badge tone={items.length ? 'info' : 'neutral'}>
                {items.length.toLocaleString('fa-IR')} خانواده
              </Badge>
            </div>
            {!items.length ? (
              <Surface className={styles.empty}>
                خانواده‌ای با کارت فعال در شعبهٔ انتخاب‌شده پیدا نشد.
              </Surface>
            ) : (
              visibleHouseholds.map((household) => (
                <Surface className={styles.household} key={household.householdId}>
                  <div className={styles.householdHeading}>
                    <div>
                      <span>{view === 'lookup' ? 'خانوادهٔ پیدا‌شده' : 'خانواده'}</span>
                      <h2>{household.householdName}</h2>
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
                                  <small>نسبت قدیمی ثبت‌شده: {member.legacyRelationship}</small>
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
                      <section className={styles.invitationHistory} aria-label="دعوت‌های خانواده">
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
                    ) : (
                      <p className={styles.privacy}>دعوتی برای نمایش ثبت نشده است.</p>
                    ))}
                  {view === 'history' &&
                    (household.history.length ? (
                      <section className={styles.invitationHistory} aria-label="تاریخچهٔ خانواده">
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
                      </section>
                    ) : (
                      <p className={styles.privacy}>تغییری برای نمایش ثبت نشده است.</p>
                    ))}
                </Surface>
              ))
            )}
          </section>
        )}
      </ManagementListPage>
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
