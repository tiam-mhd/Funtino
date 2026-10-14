'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import { listOperationsBranches, type OperationsBranch } from '../../lib/api/operations-devices';
import { getOperationsReport, type OperationsReport } from '../../lib/api/operations-reports';
import { type OperationsScope, type OperationsScopeOption } from '../../lib/auth/operations-access';
import styles from './OperationsBranchDirectory.module.css';

type Props = {
  scope: Extract<OperationsScope, { type: 'organization' }>;
  scopeOption: OperationsScopeOption;
  onSelectScope: (scope: OperationsScope) => void | Promise<void>;
  onSessionExpired: () => void;
};

type StatusFilter = 'all' | 'active' | 'suspended' | 'archived';
type BranchRow = {
  id: string;
  name: string;
  city: string | null;
  status: 'active' | 'suspended' | 'archived';
  devicesTotal: number | null;
  online: number | null;
  attention: number | null;
  hasReport: boolean;
};

export function OperationsBranchDirectory({
  scope,
  scopeOption,
  onSelectScope,
  onSessionExpired,
}: Props) {
  const [branches, setBranches] = useState<OperationsBranch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectingBranchId, setSelectingBranchId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reportWarning, setReportWarning] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const requestId = useRef(0);

  const loadDirectory = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setReportWarning('');
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(`${to}T00:00:00.000Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    const from = fromDate.toISOString().slice(0, 10);

    const [branchResult, reportResult] = await Promise.allSettled([
      listOperationsBranches(scope.organizationId),
      getOperationsReport(scope, from, to),
    ]);
    if (currentRequest !== requestId.current) return;

    if (branchResult.status === 'fulfilled') {
      setBranches(branchResult.value.data);
      setCursor(branchResult.value.nextCursor);
    } else if (
      branchResult.reason instanceof ApiRequestError &&
      branchResult.reason.status === 401
    ) {
      onSessionExpired();
      setLoading(false);
      return;
    } else {
      setError(branchMessageFor(branchResult.reason));
      setBranches([]);
      setCursor(null);
    }

    if (reportResult.status === 'fulfilled') {
      const nextReport = reportResult.value;
      if (
        nextReport.scope.scopeType === 'organization' &&
        nextReport.scope.organizationId.toLowerCase() === scope.organizationId.toLowerCase()
      ) {
        setReport(nextReport);
      } else {
        setReport(null);
        setReportWarning(
          'پاسخ گزارش با محدودهٔ انتخاب‌شده هماهنگ نبود؛ شاخص‌ها نمایش داده نمی‌شوند.',
        );
      }
    } else if (
      reportResult.reason instanceof ApiRequestError &&
      reportResult.reason.status === 401
    ) {
      onSessionExpired();
      setReport(null);
    } else {
      setReport(null);
      setReportWarning(reportMessageFor(reportResult.reason));
    }
    setLoading(false);
  }, [onSessionExpired, scope]);

  useEffect(() => {
    void loadDirectory();
    return () => {
      requestId.current += 1;
    };
  }, [loadDirectory]);

  const rows = useMemo(() => mergeBranches(branches, report), [branches, report]);
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fa');
    return rows
      .filter((branch) => statusFilter === 'all' || branch.status === statusFilter)
      .filter(
        (branch) =>
          !normalizedQuery ||
          `${branch.name} ${branch.city ?? ''}`.toLocaleLowerCase('fa').includes(normalizedQuery),
      )
      .sort(
        (left, right) =>
          (right.attention ?? -1) - (left.attention ?? -1) ||
          left.name.localeCompare(right.name, 'fa'),
      );
  }, [query, rows, statusFilter]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listOperationsBranches(scope.organizationId, cursor);
      setBranches((current) => appendUnique(current, page.data));
      setCursor(page.nextCursor);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setError(branchMessageFor(failure));
    } finally {
      setLoadingMore(false);
    }
  }

  async function openBranch(branchId: string) {
    setSelectingBranchId(branchId);
    try {
      await onSelectScope({ type: 'branch', organizationId: scope.organizationId, branchId });
    } finally {
      setSelectingBranchId(null);
    }
  }

  const activeCount =
    report?.snapshot.branches.active ?? (cursor || error ? null : branches.length);
  const activeCountDetail = report
    ? 'طبق snapshot گزارش'
    : cursor
      ? 'فهرست صفحه‌بندی شده؛ شمارش کل در دسترس نیست'
      : error
        ? 'فهرست شعب در دسترس نیست'
        : 'از فهرست مجاز شعب';
  const attentionCount = report
    ? report.snapshot.devices.health.degraded +
      report.snapshot.devices.health.offline +
      report.snapshot.devices.health.stale +
      report.snapshot.devices.health.unknown
    : null;

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>مدیریت محدوده</span>
          <h2>شعب {scopeOption.organization.name}</h2>
          <p>فهرست شعب فعال از سرویس سازمان و آمار سلامت از گزارش تجمیعی بارگذاری می‌شود.</p>
        </div>
        <Button disabled={loading} onClick={() => void loadDirectory()} tone="ghost" type="button">
          <RefreshIcon /> {loading ? 'در حال دریافت' : 'تازه‌سازی'}
        </Button>
      </section>

      {error && (
        <Surface className={styles.errorPanel} role="alert">
          <span aria-hidden="true">
            <WarningIcon />
          </span>
          <div>
            <strong>فهرست شعب بارگذاری نشد</strong>
            <p>{error}</p>
          </div>
          <Button disabled={loading} onClick={() => void loadDirectory()} type="button">
            تلاش دوباره
          </Button>
        </Surface>
      )}

      <section aria-label="خلاصهٔ شعب و دستگاه‌ها" className={styles.summaryGrid}>
        <SummaryCard
          label="شعب فعال"
          value={loading && !report ? null : activeCount}
          detail={activeCountDetail}
          tone="teal"
          icon={<BranchIcon />}
        />
        <SummaryCard
          label="دستگاه‌ها"
          value={report?.snapshot.devices.total ?? null}
          detail="در محدودهٔ همین مجموعه"
          tone="purple"
          icon={<DeviceIcon />}
        />
        <SummaryCard
          label="نیازمند رسیدگی"
          value={attentionCount}
          detail="اختلال، آفلاین، قدیمی یا نامشخص"
          tone={attentionCount ? 'orange' : 'blue'}
          icon={<WarningIcon />}
        />
      </section>

      {reportWarning && (
        <div className={styles.reportWarning} role="status">
          <InfoIcon />
          <p>{reportWarning} فهرست شعب همچنان از سرویس سازمان دریافت می‌شود.</p>
        </div>
      )}

      {report?.projection.lastProcessedAt && (
        <div className={styles.dataTimestamp}>
          <InfoIcon />
          <span>
            زمان آخرین پردازش آمار: <strong>{formatDate(report.projection.lastProcessedAt)}</strong>
          </span>
          {report.snapshot.branchBreakdownTruncated && (
            <Badge tone="warning">بخشی از آمار شعب در گزارش خلاصه شده</Badge>
          )}
        </div>
      )}

      <Surface className={styles.directoryPanel}>
        <div className={styles.directoryHeading}>
          <div>
            <span className={styles.eyebrow}>فهرست</span>
            <h3>
              شعب بارگذاری‌شده <span>{formatNumber(rows.length)}</span>
            </h3>
          </div>
          <label className={styles.searchBox}>
            <SearchIcon />
            <span className={styles.srOnly}>جست‌وجوی شعبه</span>
            <input
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="نام شعبه یا شهر"
              type="search"
              value={query}
            />
            {query && (
              <button aria-label="پاک کردن جست‌وجو" onClick={() => setQuery('')} type="button">
                ×
              </button>
            )}
          </label>
        </div>

        <div aria-label="فیلتر وضعیت شعب" className={styles.filters} role="group">
          {(
            [
              ['all', 'همه'],
              ['active', 'فعال'],
              ['suspended', 'تعلیق‌شده'],
              ['archived', 'بایگانی‌شده'],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={statusFilter === value}
              className={statusFilter === value ? styles.filterActive : ''}
              key={value}
              onClick={() => setStatusFilter(value)}
              type="button"
            >
              {label}
              {value === 'all' && <span>{formatNumber(rows.length)}</span>}
            </button>
          ))}
          <span className={styles.resultCount}>نمایش {formatNumber(visibleRows.length)} شعبه</span>
        </div>
        {query && cursor && (
          <p className={styles.searchNote}>
            جست‌وجو روی شعبی انجام می‌شود که تا این لحظه بارگذاری شده‌اند؛ برای پوشش ادامهٔ فهرست،
            «نمایش شعب بیشتر» را انتخاب کنید.
          </p>
        )}

        {loading && branches.length === 0 && !error ? (
          <div className={styles.loadingState} role="status">
            <span className={styles.spinner} />
            در حال دریافت فهرست مجاز شعب…
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">شعبه</th>
                    <th scope="col">وضعیت</th>
                    <th scope="col">دستگاه</th>
                    <th scope="col">آنلاین</th>
                    <th scope="col">نیازمند رسیدگی</th>
                    <th scope="col">
                      <span className={styles.srOnly}>عملیات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((branch) => (
                    <tr key={branch.id}>
                      <td>
                        <div className={styles.branchCell}>
                          <span className={styles.branchIcon} aria-hidden="true">
                            <BranchIcon />
                          </span>
                          <span>
                            <strong>{branch.name}</strong>
                            <small>{branch.city || 'شهر ثبت نشده'}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={branch.status} />
                      </td>
                      <td>
                        {branch.devicesTotal === null ? (
                          <span className={styles.unavailable}>—</span>
                        ) : (
                          formatNumber(branch.devicesTotal)
                        )}
                      </td>
                      <td>
                        {branch.online === null ? (
                          <span className={styles.unavailable}>—</span>
                        ) : (
                          formatNumber(branch.online)
                        )}
                      </td>
                      <td>
                        {branch.attention === null ? (
                          <span className={styles.unavailable}>—</span>
                        ) : (
                          <Badge tone={branch.attention ? 'warning' : 'success'}>
                            {formatNumber(branch.attention)}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <Button
                          className={styles.branchAction}
                          disabled={branch.status !== 'active' || selectingBranchId !== null}
                          onClick={() => void openBranch(branch.id)}
                          title={
                            branch.status !== 'active'
                              ? 'ورود به محدوده فقط برای شعبهٔ فعال امکان‌پذیر است'
                              : undefined
                          }
                          tone="ghost"
                          type="button"
                        >
                          {selectingBranchId === branch.id ? 'در حال بررسی…' : 'ورود به شعبه'}
                          <ArrowIcon />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div aria-label="فهرست شعب" className={styles.mobileDirectory} role="list">
              {visibleRows.map((branch) => (
                <article
                  aria-label={`شعبهٔ ${branch.name}`}
                  className={styles.mobileBranchCard}
                  key={branch.id}
                  role="listitem"
                >
                  <div className={styles.mobileBranchHeading}>
                    <div className={styles.branchCell}>
                      <span className={styles.branchIcon} aria-hidden="true">
                        <BranchIcon />
                      </span>
                      <span>
                        <strong>{branch.name}</strong>
                        <small>{branch.city || 'شهر ثبت نشده'}</small>
                      </span>
                    </div>
                    <StatusBadge status={branch.status} />
                  </div>
                  <dl className={styles.mobileBranchMetrics}>
                    <div>
                      <dt>دستگاه‌ها</dt>
                      <dd>
                        {branch.devicesTotal === null
                          ? 'در گزارش نیست'
                          : formatNumber(branch.devicesTotal)}
                      </dd>
                    </div>
                    <div>
                      <dt>آنلاین</dt>
                      <dd>
                        {branch.online === null ? 'در گزارش نیست' : formatNumber(branch.online)}
                      </dd>
                    </div>
                    <div>
                      <dt>نیازمند رسیدگی</dt>
                      <dd>
                        {branch.attention === null ? (
                          <span className={styles.unavailable}>در گزارش نیست</span>
                        ) : (
                          <Badge tone={branch.attention ? 'warning' : 'success'}>
                            {formatNumber(branch.attention)}
                          </Badge>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <Button
                    className={styles.branchAction}
                    disabled={branch.status !== 'active' || selectingBranchId !== null}
                    onClick={() => void openBranch(branch.id)}
                    title={
                      branch.status !== 'active'
                        ? 'ورود به محدوده فقط برای شعبهٔ فعال امکان‌پذیر است'
                        : undefined
                    }
                    tone="ghost"
                    type="button"
                  >
                    {selectingBranchId === branch.id ? 'در حال بررسی…' : 'ورود به شعبه'}
                    <ArrowIcon />
                  </Button>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <BranchIcon />
            </span>
            <strong>
              {rows.length === 0
                ? 'شعبه‌ای برای نمایش وجود ندارد'
                : 'شعبه‌ای با این فیلتر پیدا نشد'}
            </strong>
            <p>
              {rows.length === 0
                ? 'فهرست فقط شعبی را نشان می‌دهد که سرویس سازمان برای این دسترسی مجاز دانسته است.'
                : 'عبارت جست‌وجو یا فیلتر وضعیت را تغییر دهید.'}
            </p>
            {query && (
              <Button onClick={() => setQuery('')} tone="ghost" type="button">
                پاک کردن جست‌وجو
              </Button>
            )}
          </div>
        )}

        {cursor && (
          <div className={styles.loadMoreRow}>
            <span>فهرست صفحه‌بندی شده است؛ برای دریافت ادامه از سرویس استفاده کنید.</span>
            <Button
              disabled={loadingMore}
              onClick={() => void loadMore()}
              tone="ghost"
              type="button"
            >
              {loadingMore ? 'در حال دریافت…' : 'نمایش شعب بیشتر'}
            </Button>
          </div>
        )}
        {report?.snapshot.branchBreakdownTruncated && (
          <p className={styles.footerNote}>
            آمار هر شعبه در گزارش تجمیعی محدود است؛ وضعیت و شاخص‌های خالی را «ناموجود در گزارش» در
            نظر بگیرید.
          </p>
        )}
      </Surface>
    </div>
  );
}

function mergeBranches(branches: OperationsBranch[], report: OperationsReport | null): BranchRow[] {
  const details = new Map(
    (report?.snapshot.branchBreakdown ?? []).map((item) => [item.branchId.toLowerCase(), item]),
  );
  const rows = new Map<string, BranchRow>();
  for (const branch of branches) {
    const detail = details.get(branch.id.toLowerCase());
    rows.set(branch.id.toLowerCase(), {
      id: branch.id,
      name: branch.name,
      city: branch.city,
      status: 'active',
      devicesTotal: detail?.devicesTotal ?? null,
      online: detail?.online ?? null,
      attention: detail ? detail.degraded + detail.offline + detail.stale + detail.unknown : null,
      hasReport: Boolean(detail),
    });
  }
  for (const detail of report?.snapshot.branchBreakdown ?? []) {
    const key = detail.branchId.toLowerCase();
    if (rows.has(key)) continue;
    rows.set(key, {
      id: detail.branchId,
      name: detail.branchName || 'شعبهٔ بدون نام در گزارش',
      city: null,
      status: detail.status,
      devicesTotal: detail.devicesTotal,
      online: detail.online,
      attention: detail.degraded + detail.offline + detail.stale + detail.unknown,
      hasReport: true,
    });
  }
  return [...rows.values()];
}

function appendUnique(current: OperationsBranch[], incoming: OperationsBranch[]) {
  const byId = new Map(current.map((branch) => [branch.id.toLowerCase(), branch]));
  for (const branch of incoming) byId.set(branch.id.toLowerCase(), branch);
  return [...byId.values()];
}

function SummaryCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: number | null;
  detail: string;
  tone: string;
  icon: ReactNode;
}) {
  return (
    <Surface className={`${styles.summaryCard} ${styles[`summary_${tone}`]}`}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryIcon} aria-hidden="true">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <strong>{value === null ? '—' : formatNumber(value)}</strong>
      <small>{detail}</small>
    </Surface>
  );
}

function StatusBadge({ status }: { status: BranchRow['status'] }) {
  const labels = { active: 'فعال', suspended: 'تعلیق‌شده', archived: 'بایگانی‌شده' };
  const tones = { active: 'success', suspended: 'warning', archived: 'neutral' } as const;
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}

function branchMessageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403) return 'مجوز خواندن فهرست شعب در این محدوده صادر نشده است.';
    if (failure.status === 503) return 'سرویس شعب موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.';
    if (failure.status === 0) return 'ارتباط با سرویس شعب برقرار نشد. اتصال شبکه را بررسی کنید.';
    return failure.message;
  }
  return 'فهرست شعب آماده نشد. دوباره تلاش کنید.';
}

function reportMessageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403) return 'مجوز مشاهدهٔ آمار تجمیعی شعب در این محدوده صادر نشده است.';
    if (failure.status === 503) return 'سرویس گزارش موقتاً در دسترس نیست.';
    if (failure.status === 0) return 'اتصال به سرویس گزارش برقرار نشد.';
  }
  return 'آمار سلامت دستگاه‌ها از سرویس گزارش در دسترس نیست.';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fa-IR').format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'زمان نامعتبر'
    : new Intl.DateTimeFormat('fa-IR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(date);
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 7v5h-5M4 17v-5h5M5.6 9A7 7 0 0 1 18 6.5L20 12M4 12l2 5.5A7 7 0 0 0 18.4 15" />
    </svg>
  );
}
function BranchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 20v-5a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V4" />
      <circle cx="6" cy="20" r="2" />
      <circle cx="18" cy="4" r="2" />
      <circle cx="18" cy="20" r="2" />
      <path d="M18 6v12" />
    </svg>
  );
}
function DeviceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h2" />
      <circle cx="16" cy="16" r="1" />
    </svg>
  );
}
function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3 2.8 19a1.6 1.6 0 0 0 1.4 2.4h15.6a1.6 1.6 0 0 0 1.4-2.4L12 3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
