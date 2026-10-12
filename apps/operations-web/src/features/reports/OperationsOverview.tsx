'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  getOperationsReport,
  type OperationsDailyReportRow,
  type OperationsReport,
} from '../../lib/api/operations-reports';
import {
  scopeKey,
  type OperationsScope,
  type OperationsScopeOption,
} from '../../lib/auth/operations-access';
import type { WorkspaceSection } from '../../components/workspace-shell/OperationsWorkspaceShell';
import styles from './OperationsOverview.module.css';

type Props = {
  scope: OperationsScope;
  scopeOption: OperationsScopeOption;
  onNavigate: (section: WorkspaceSection) => void;
  onSelectScope: (scope: OperationsScope) => void | Promise<void>;
  onSessionExpired: () => void;
};

type RangeDays = 7 | 30;

const eventFields: Array<keyof Omit<OperationsDailyReportRow, 'date'>> = [
  'branchesCreated',
  'branchStatusChanges',
  'devicesRegistered',
  'deviceUpdates',
  'healthOnline',
  'healthDegraded',
  'healthOffline',
];

const eventLabels: Record<(typeof eventFields)[number], string> = {
  branchesCreated: 'ایجاد شعبه',
  branchStatusChanges: 'تغییر وضعیت شعبه',
  devicesRegistered: 'ثبت دستگاه',
  deviceUpdates: 'به‌روزرسانی دستگاه',
  healthOnline: 'گزارش سلامت آنلاین',
  healthDegraded: 'گزارش اختلال',
  healthOffline: 'گزارش آفلاین',
};

export function OperationsOverview({
  scope,
  scopeOption,
  onNavigate,
  onSelectScope,
  onSessionExpired,
}: Props) {
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const activeScopeKey = scopeKey(scope);

  const loadReport = useCallback(
    async (days: RangeDays) => {
      const currentRequest = ++requestId.current;
      const to = new Date().toISOString().slice(0, 10);
      const fromDate = new Date(`${to}T00:00:00.000Z`);
      fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
      const from = fromDate.toISOString().slice(0, 10);
      setLoading(true);
      setError('');

      try {
        const nextReport = await getOperationsReport(scope, from, to);
        if (
          nextReport.scope.scopeType !== scope.type ||
          nextReport.scope.organizationId.toLowerCase() !== scope.organizationId.toLowerCase() ||
          (nextReport.scope.branchId?.toLowerCase() ?? null) !==
            (scope.type === 'branch' ? scope.branchId.toLowerCase() : null)
        ) {
          throw new Error('SCOPE_MISMATCH');
        }
        if (currentRequest === requestId.current) setReport(nextReport);
      } catch (failure) {
        if (currentRequest !== requestId.current) return;
        if (failure instanceof ApiRequestError && failure.status === 401) {
          onSessionExpired();
        } else {
          setError(messageFor(failure));
          setReport(null);
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [onSessionExpired, scope],
  );

  useEffect(() => {
    void loadReport(7);
    return () => {
      requestId.current += 1;
    };
  }, [activeScopeKey, loadReport]);

  const summary = useMemo(() => {
    if (!report) return null;
    const { branches, devices } = report.snapshot;
    const attention =
      devices.health.degraded +
      devices.health.offline +
      devices.health.stale +
      devices.health.unknown;
    const events = report.daily.reduce(
      (total, row) => total + eventFields.reduce((dayTotal, field) => dayTotal + row[field], 0),
      0,
    );
    return { branches, devices, attention, events };
  }, [report]);

  const eventDays = useMemo(() => {
    if (!report) return [];
    return report.daily.slice(-rangeDays).map((row) => ({
      ...row,
      total: eventFields.reduce((total, field) => total + row[field], 0),
    }));
  }, [rangeDays, report]);
  const maxEvents = Math.max(1, ...eventDays.map((day) => day.total));

  function changeRange(days: RangeDays) {
    setRangeDays(days);
    void loadReport(days);
  }

  const attentionCount = summary?.attention ?? 0;
  const branchRows = report?.snapshot.branchBreakdown ?? [];
  const prioritizedBranches = [...branchRows]
    .sort(
      (left, right) =>
        attentionFor(right) - attentionFor(left) ||
        left.branchName?.localeCompare(right.branchName ?? '', 'fa') ||
        0,
    )
    .slice(0, 5);

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="operations-overview-title">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>نمای عملیاتی</span>
          <h2 id="operations-overview-title">
            {scope.type === 'organization'
              ? `نمای کلی ${scopeOption.organization.name}`
              : `وضعیت ${scopeOption.branch?.name ?? 'شعبه'}`}
          </h2>
          <p>تصویر خلاصه از شعب، دستگاه‌ها و رویدادهای ثبت‌شده در محدودهٔ مجاز شما.</p>
        </div>
        <div className={styles.heroMeta}>
          <Badge tone="info">
            {scope.type === 'organization' ? 'محدودهٔ مجموعه' : 'محدودهٔ شعبه'}
          </Badge>
          <Button
            className={styles.refreshButton}
            disabled={loading}
            onClick={() => void loadReport(rangeDays)}
            tone="ghost"
            type="button"
          >
            <RefreshIcon />
            {loading ? 'در حال دریافت' : 'به‌روزرسانی'}
          </Button>
        </div>
      </section>

      {error && (
        <Surface className={styles.errorPanel} role="alert">
          <span className={styles.stateIcon} aria-hidden="true">
            <WarningIcon />
          </span>
          <div>
            <strong>گزارش بارگذاری نشد</strong>
            <p>{error}</p>
          </div>
          <Button disabled={loading} onClick={() => void loadReport(rangeDays)} type="button">
            تلاش دوباره
          </Button>
        </Surface>
      )}

      {loading && !report && !error && (
        <Surface className={styles.loadingPanel} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>در حال دریافت آمار از سرویس گزارش…</span>
        </Surface>
      )}

      {report && summary && (
        <>
          <section aria-label="خلاصهٔ شاخص‌ها" className={styles.metricsGrid}>
            <MetricCard
              icon={<BranchIcon />}
              label="شعبهٔ فعال"
              value={summary.branches.active}
              detail={`${formatNumber(summary.branches.suspended)} شعبهٔ تعلیق‌شده`}
              tone="teal"
            />
            <MetricCard
              icon={<DeviceIcon />}
              label="کل دستگاه‌ها"
              value={summary.devices.total}
              detail={`${formatNumber(summary.devices.active)} دستگاه با چرخهٔ فعال`}
              tone="purple"
            />
            <MetricCard
              icon={<WarningIcon />}
              label="نیازمند رسیدگی"
              value={attentionCount}
              detail="اختلال، آفلاین، دادهٔ قدیمی یا وضعیت نامشخص"
              tone={attentionCount ? 'orange' : 'green'}
              emphasized={attentionCount > 0}
            />
            <MetricCard
              icon={<ActivityIcon />}
              label={`رویداد در ${formatNumber(report.period.days)} روز`}
              value={summary.events}
              detail={`${formatNumber(summary.devices.health.online)} گزارش سلامت آنلاین`}
              tone="blue"
            />
          </section>

          {report.snapshot.devices.total === 0 && (
            <Surface className={styles.emptyNotice}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <DeviceIcon />
              </span>
              <div>
                <strong>هنوز دستگاهی در این محدوده ثبت نشده است</strong>
                <p>
                  پس از اتصال دستگاه‌ها، سلامت و رویدادهای آن‌ها در همین داشبورد نمایش داده می‌شود.
                </p>
              </div>
              <Button onClick={() => onNavigate('devices')} tone="ghost" type="button">
                رفتن به دستگاه‌ها
              </Button>
            </Surface>
          )}

          {report.projection.coverageStartedAt && (
            <div className={styles.coverage}>
              <span aria-hidden="true">
                <InfoIcon />
              </span>
              <p>
                گزارش‌ها از <strong>{formatDate(report.projection.coverageStartedAt)}</strong> پوشش
                دارند. آخرین پردازش:{' '}
                <strong>
                  {report.projection.lastProcessedAt
                    ? formatDate(report.projection.lastProcessedAt)
                    : 'هنوز ثبت نشده'}
                </strong>
              </p>
            </div>
          )}

          <div className={styles.contentGrid}>
            <Surface className={styles.activityPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>روند ثبت‌شده</span>
                  <h3>فعالیت روزانه</h3>
                  <p>مجموع رویدادهای ثبت شعبه، دستگاه و گزارش سلامت</p>
                </div>
                <div aria-label="بازهٔ زمانی" className={styles.rangeControl} role="group">
                  {([7, 30] as const).map((days) => (
                    <button
                      aria-pressed={rangeDays === days}
                      className={rangeDays === days ? styles.rangeActive : ''}
                      disabled={loading}
                      key={days}
                      onClick={() => changeRange(days)}
                      type="button"
                    >
                      {formatNumber(days)} روز
                    </button>
                  ))}
                </div>
              </div>
              {eventDays.length > 0 ? (
                <div className={styles.chartWrap}>
                  <div
                    aria-label={`نمودار رویدادهای روزانه، مجموع ${formatNumber(summary.events)} رویداد`}
                    className={styles.chart}
                    role="img"
                  >
                    {eventDays.map((day) => {
                      const height =
                        day.total === 0 ? 3 : Math.max(8, (day.total / maxEvents) * 100);
                      return (
                        <div
                          className={styles.chartColumn}
                          key={day.date}
                          title={eventBreakdown(day)}
                        >
                          <span className={styles.chartValue}>{formatNumber(day.total)}</span>
                          <span className={styles.chartTrack}>
                            <span className={styles.chartBar} style={{ height: `${height}%` }} />
                          </span>
                          <span className={styles.chartLabel}>{formatDay(day.date)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <table className={styles.srOnly}>
                    <caption>مجموع رویدادهای ثبت‌شده به تفکیک روز</caption>
                    <thead>
                      <tr>
                        <th scope="col">تاریخ</th>
                        <th scope="col">رویدادها</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eventDays.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{formatDateOnly(day.date)}</th>
                          <td>{day.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="داده‌ای برای این بازه نیست"
                  detail="با ثبت رویدادهای عملیاتی، روند روزانه در این بخش دیده می‌شود."
                />
              )}
              <div className={styles.chartFooter}>
                <span>
                  <span className={styles.legendDot} /> رویدادهای همین بازه
                </span>
                <button
                  className={styles.linkButton}
                  onClick={() => onNavigate('reports')}
                  type="button"
                >
                  جزئیات گزارش‌ها <ArrowIcon />
                </button>
              </div>
            </Surface>

            <Surface className={styles.healthPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>پایش دستگاه</span>
                  <h3>سلامت فعلی</h3>
                  <p>بر پایهٔ آخرین وضعیت موجود در گزارش سرویس</p>
                </div>
                <span className={styles.healthPulse} aria-hidden="true">
                  <ActivityIcon />
                </span>
              </div>
              <div className={styles.healthList}>
                <HealthRow
                  label="آنلاین"
                  value={summary.devices.health.online}
                  total={summary.devices.total}
                  tone="green"
                />
                <HealthRow
                  label="دارای اختلال"
                  value={summary.devices.health.degraded}
                  total={summary.devices.total}
                  tone="orange"
                />
                <HealthRow
                  label="آفلاین"
                  value={summary.devices.health.offline}
                  total={summary.devices.total}
                  tone="red"
                />
                <HealthRow
                  label="دادهٔ قدیمی"
                  value={summary.devices.health.stale}
                  total={summary.devices.total}
                  tone="purple"
                />
                <HealthRow
                  label="نامشخص"
                  value={summary.devices.health.unknown}
                  total={summary.devices.total}
                  tone="gray"
                />
              </div>
              <Button
                className={styles.fullButton}
                onClick={() => onNavigate('devices')}
                tone="ghost"
                type="button"
              >
                مشاهدهٔ دستگاه‌ها <ArrowIcon />
              </Button>
            </Surface>
          </div>

          <Surface className={styles.branchesPanel}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.eyebrow}>
                  {scope.type === 'organization' ? 'مقایسهٔ شعب' : 'وضعیت محدوده'}
                </span>
                <h3>{scope.type === 'organization' ? 'شعب نیازمند توجه' : 'جزئیات این شعبه'}</h3>
                <p>
                  {scope.type === 'organization'
                    ? 'بر اساس سلامت دستگاه‌ها در خروجی تجمیعی سرویس گزارش'
                    : `وضعیت شعبهٔ ${scopeOption.branch?.name ?? 'انتخاب‌شده'} در محدودهٔ فعلی`}
                </p>
              </div>
              {scope.type === 'organization' && (
                <Button onClick={() => onNavigate('branches')} tone="ghost" type="button">
                  فهرست شعب <ArrowIcon />
                </Button>
              )}
            </div>

            {scope.type === 'organization' ? (
              prioritizedBranches.length > 0 ? (
                <div className={styles.branchList}>
                  {prioritizedBranches.map((branch) => {
                    const attention = attentionFor(branch);
                    const canSelect = branch.status === 'active';
                    return (
                      <div className={styles.branchRow} key={branch.branchId}>
                        <span className={styles.branchMark} aria-hidden="true">
                          <BranchIcon />
                        </span>
                        <div className={styles.branchIdentity}>
                          <strong>{branch.branchName || 'شعبهٔ بدون نام در گزارش'}</strong>
                          <span>{statusLabel(branch.status)}</span>
                        </div>
                        <div className={styles.branchStats}>
                          <span>
                            <strong>{formatNumber(branch.devicesTotal)}</strong>
                            <small>دستگاه</small>
                          </span>
                          <span>
                            <strong>{formatNumber(branch.online)}</strong>
                            <small>آنلاین</small>
                          </span>
                        </div>
                        <Badge tone={attention ? 'warning' : 'success'}>
                          {attention
                            ? `${formatNumber(attention)} مورد توجه`
                            : 'بدون اختلال ثبت‌شده'}
                        </Badge>
                        <Button
                          className={styles.branchAction}
                          disabled={!canSelect}
                          onClick={() =>
                            void onSelectScope({
                              type: 'branch',
                              organizationId: scope.organizationId,
                              branchId: branch.branchId,
                            })
                          }
                          title={
                            canSelect
                              ? undefined
                              : 'فقط شعبهٔ فعال قابلیت انتخاب به‌عنوان محدوده را دارد'
                          }
                          tone="ghost"
                          type="button"
                        >
                          ورود به شعبه <ArrowIcon />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="هنوز دادهٔ مقایسهٔ شعبه‌ای ثبت نشده"
                  detail="این گزارش تنها شعبی را نشان می‌دهد که دادهٔ آن‌ها در read model موجود است."
                />
              )
            ) : (
              <BranchSummary
                report={report}
                scope={scope}
                scopeOption={scopeOption}
                onNavigate={onNavigate}
              />
            )}
            {scope.type === 'organization' && report.snapshot.branchBreakdownTruncated && (
              <p className={styles.truncationNotice}>
                گزارش مقایسه به دلیل محدودیت خروجی خلاصه شده است؛ برای فهرست کامل، «فهرست شعب» را
                باز کنید.
              </p>
            )}
          </Surface>

          <footer className={styles.reportMeta}>
            <span>
              <InfoIcon /> مبنای داده: گزارش تجمیعی عملیاتی
            </span>
            <span>
              آخرین پردازش:{' '}
              {report.projection.lastProcessedAt
                ? formatDate(report.projection.lastProcessedAt)
                : 'ثبت نشده'}
            </span>
            <span>
              شناسهٔ تولید گزارش: <code dir="ltr">{report.projection.generationId}</code>
            </span>
          </footer>
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  emphasized = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
  tone: 'teal' | 'purple' | 'orange' | 'green' | 'blue';
  emphasized?: boolean;
}) {
  return (
    <Surface
      className={`${styles.metricCard} ${styles[`metric_${tone}`]} ${emphasized ? styles.metricEmphasized : ''}`}
    >
      <div className={styles.metricTop}>
        <span className={styles.metricIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.metricLabel}>{label}</span>
      </div>
      <strong className={styles.metricValue}>{formatNumber(value)}</strong>
      <small>{detail}</small>
    </Surface>
  );
}

function HealthRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className={styles.healthRow}>
      <div className={styles.healthRowText}>
        <span>{label}</span>
        <strong>{formatNumber(value)}</strong>
      </div>
      <span
        className={styles.healthTrack}
        role="img"
        aria-label={`${label}: ${formatNumber(value)} از ${formatNumber(total)} دستگاه`}
      >
        <span
          className={`${styles.healthValue} ${styles[`health_${tone}`]}`}
          style={{ width: `${percent}%` }}
        />
      </span>
    </div>
  );
}

function BranchSummary({
  report,
  scope,
  scopeOption,
  onNavigate,
}: {
  report: OperationsReport;
  scope: Extract<OperationsScope, { type: 'branch' }>;
  scopeOption: OperationsScopeOption;
  onNavigate: (section: WorkspaceSection) => void;
}) {
  const branch = report.snapshot.branchBreakdown.find(
    (item) => item.branchId.toLowerCase() === scope.branchId.toLowerCase(),
  );
  if (!branch) {
    return (
      <EmptyState
        title="جزئیات شعبه در گزارش موجود نیست"
        detail="دسترسی به محدوده برقرار است، اما گزارش تجمیعی هنوز این شعبه را پوشش نمی‌دهد."
      />
    );
  }
  const attention = attentionFor(branch);
  return (
    <div className={styles.singleBranchSummary}>
      <div className={styles.singleBranchTitle}>
        <span className={styles.branchMark} aria-hidden="true">
          <BranchIcon />
        </span>
        <div>
          <strong>{branch.branchName || scopeOption.branch?.name || 'شعبه'}</strong>
          <span>{statusLabel(branch.status)}</span>
        </div>
        <Badge tone={attention ? 'warning' : 'success'}>
          {attention ? `${formatNumber(attention)} مورد توجه` : 'بدون اختلال ثبت‌شده'}
        </Badge>
      </div>
      <div className={styles.singleBranchMetrics}>
        <span>
          <strong>{formatNumber(branch.devicesTotal)}</strong>
          <small>دستگاه</small>
        </span>
        <span>
          <strong>{formatNumber(branch.online)}</strong>
          <small>آنلاین</small>
        </span>
        <span>
          <strong>
            {formatNumber(branch.degraded + branch.offline + branch.stale + branch.unknown)}
          </strong>
          <small>نیازمند رسیدگی</small>
        </span>
      </div>
      <Button onClick={() => onNavigate('devices')} tone="ghost" type="button">
        رفتن به دستگاه‌ها <ArrowIcon />
      </Button>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <InfoIcon />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function attentionFor(branch: OperationsReport['snapshot']['branchBreakdown'][number]) {
  return branch.degraded + branch.offline + branch.stale + branch.unknown;
}

function eventBreakdown(day: OperationsDailyReportRow) {
  const details = eventFields
    .filter((field) => day[field] > 0)
    .map((field) => `${eventLabels[field]}: ${formatNumber(day[field])}`);
  return `${formatDateOnly(day.date)}؛ ${details.length > 0 ? details.join('، ') : 'بدون رویداد'}`;
}

function statusLabel(status: OperationsReport['snapshot']['branchBreakdown'][number]['status']) {
  return { active: 'فعال', suspended: 'تعلیق‌شده', archived: 'بایگانی‌شده' }[status];
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403)
      return 'مجوز مشاهدهٔ گزارش در این محدوده صادر نشده است. مدیر دسترسی شما می‌تواند آن را بررسی کند.';
    if (failure.status === 503)
      return 'سرویس گزارش موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.';
    if (failure.status === 0) return 'ارتباط با سرویس برقرار نشد. اتصال شبکه را بررسی کنید.';
    return failure.message;
  }
  if (failure instanceof Error && failure.message === 'SCOPE_MISMATCH') {
    return 'محدودهٔ پاسخ گزارش با محدودهٔ انتخاب‌شده یکسان نیست؛ داده نمایش داده نشد.';
  }
  return 'گزارش آماده نشد. دوباره تلاش کنید.';
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

function formatDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('fa-IR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
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
function ActivityIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
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
function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
