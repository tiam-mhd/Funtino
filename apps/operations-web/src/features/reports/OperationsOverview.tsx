'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Surface } from '@funtino/design-system';
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

type PeriodDays = 7 | 30 | 90;

type Props = {
  scope: OperationsScope;
  scopeOption: OperationsScopeOption;
  onNavigate: (section: WorkspaceSection) => void;
  onSessionExpired: () => void;
};

const periods: Array<{ days: PeriodDays; label: string }> = [
  { days: 7, label: '۷ روز' },
  { days: 30, label: '۳۰ روز' },
  { days: 90, label: '۹۰ روز' },
];

export function OperationsOverview({ scope, scopeOption, onNavigate, onSessionExpired }: Props) {
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [selectedDays, setSelectedDays] = useState<PeriodDays>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const activeScopeKey = scopeKey(scope);

  const loadReport = useCallback(
    async (periodDays: PeriodDays) => {
      const currentRequest = ++requestId.current;
      const to = new Date().toISOString().slice(0, 10);
      const fromDate = new Date(to + 'T00:00:00.000Z');
      fromDate.setUTCDate(fromDate.getUTCDate() - periodDays + 1);
      const from = fromDate.toISOString().slice(0, 10);
      setLoading(true);
      setError('');

      try {
        const nextReport = await getOperationsReport(scope, from, to);
        if (!matchesScope(nextReport, scope) || nextReport.period.days !== periodDays) {
          throw new Error('REPORT_MISMATCH');
        }
        if (currentRequest === requestId.current) setReport(nextReport);
      } catch (failure) {
        if (currentRequest !== requestId.current) return;
        setReport(null);
        if (failure instanceof ApiRequestError && failure.status === 401) {
          onSessionExpired();
        } else {
          setError(messageFor(failure));
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [onSessionExpired, scope],
  );

  useEffect(() => {
    void loadReport(selectedDays);
    return () => {
      requestId.current += 1;
    };
  }, [activeScopeKey, loadReport, selectedDays]);

  const currentReport =
    report && report.period.days === selectedDays && matchesScope(report, scope) ? report : null;

  const summary = useMemo(() => {
    if (!currentReport) return null;
    const { branches, devices } = currentReport.snapshot;
    const attention =
      devices.health.degraded +
      devices.health.offline +
      devices.health.stale +
      devices.health.unknown;
    const healthTotal =
      devices.health.online +
      devices.health.degraded +
      devices.health.offline +
      devices.health.stale +
      devices.health.unknown;
    const activities = currentReport.daily
      .slice()
      .sort((left, right) => right.date.localeCompare(left.date))
      .map(activityForDay);
    const events = activities.reduce((total, day) => total + day.total, 0);

    return { branches, devices, attention, healthTotal, activities, events };
  }, [currentReport]);

  const scopeName =
    scope.type === 'organization'
      ? scopeOption.organization.name
      : (scopeOption.branch?.name ?? 'شعبهٔ انتخاب‌شده');

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="operations-overview-title">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <OverviewIcon />
            یک نگاه به وضعیت امروز
          </span>
          <h2 id="operations-overview-title">وضعیت {scopeName} در یک نگاه</h2>
          <p>شعب، دستگاه‌ها و تغییرات روزانه را یکجا ببینید.</p>
        </div>
        <div className={styles.heroActions}>
          {summary && (
            <DeviceStatus
              attention={summary.attention}
              online={summary.devices.health.online}
              total={summary.devices.total}
            />
          )}
          <Button
            aria-label="به‌روزرسانی اطلاعات"
            className={styles.refreshButton + (loading ? ' ' + styles.refreshing : '')}
            disabled={loading}
            onClick={() => void loadReport(selectedDays)}
            tone="ghost"
            type="button"
          >
            <RefreshIcon />
            <span>{loading ? 'در حال به‌روزرسانی' : 'به‌روزرسانی'}</span>
          </Button>
        </div>
      </section>

      {error && (
        <Surface className={styles.errorPanel} role="alert">
          <span className={styles.stateIcon} aria-hidden="true">
            <WarningIcon />
          </span>
          <div>
            <strong>اطلاعات این صفحه بارگذاری نشد</strong>
            <p>{error}</p>
          </div>
          <Button disabled={loading} onClick={() => void loadReport(selectedDays)} type="button">
            تلاش دوباره
          </Button>
        </Surface>
      )}

      {loading && !currentReport && !error && <LoadingDashboard />}

      {currentReport && summary && (
        <>
          <section aria-label="خلاصهٔ وضعیت" className={styles.metricsGrid}>
            <MetricCard
              detail={formatNumber(summary.branches.suspended) + ' شعبهٔ غیرفعال'}
              icon={<BranchIcon />}
              label={scope.type === 'organization' ? 'شعب فعال' : 'وضعیت فعال شعبه'}
              tone="teal"
              value={summary.branches.active}
            />
            <MetricCard
              detail={formatNumber(summary.devices.active) + ' دستگاه فعال'}
              icon={<DeviceIcon />}
              label="همهٔ دستگاه‌ها"
              tone="blue"
              value={summary.devices.total}
            />
            <MetricCard
              detail={
                formatPercent(summary.devices.total, summary.devices.health.online) +
                '٪ از ' +
                formatNumber(summary.devices.total) +
                ' دستگاه'
              }
              icon={<WifiIcon />}
              label="دستگاه آنلاین"
              tone="green"
              value={summary.devices.health.online}
            />
            <MetricCard
              detail="دستگاه‌های دارای اختلال، آفلاین یا نیازمند بررسی"
              emphasized={summary.attention > 0}
              icon={<WarningIcon />}
              label="نیازمند رسیدگی"
              tone={summary.attention > 0 ? 'orange' : 'calm'}
              value={summary.attention}
            />
          </section>

          <div className={styles.contentGrid}>
            <Surface className={styles.activityPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>تغییرات ثبت‌شده</span>
                  <h3>فعالیت روزانه</h3>
                  <p>تعداد تغییرات شعب و دستگاه‌ها در بازهٔ انتخاب‌شده</p>
                </div>
                <div className={styles.rangeControl} aria-label="بازهٔ زمانی">
                  {periods.map((period) => (
                    <button
                      aria-pressed={selectedDays === period.days}
                      className={selectedDays === period.days ? styles.rangeActive : ''}
                      key={period.days}
                      onClick={() => setSelectedDays(period.days)}
                      type="button"
                    >
                      {period.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.chartSummary}>
                <strong>{formatNumber(summary.events)}</strong>
                <span>فعالیت در {formatNumber(currentReport.period.days)} روز</span>
              </div>

              {summary.events === 0 ? (
                <EmptyState
                  className={styles.chartEmpty}
                  icon={<ActivityIcon />}
                  title="در این بازه فعالیتی ثبت نشده است"
                  description="برای این تاریخ‌ها تغییر تازه‌ای در شعب یا دستگاه‌ها ثبت نشده است."
                />
              ) : (
                <>
                  <div className={styles.chartWrap}>
                    <div
                      aria-label="فعالیت‌های ثبت‌شده به تفکیک روز"
                      className={styles.chart}
                      role="list"
                    >
                      {summary.activities.map((day, index) => {
                        const maximum = Math.max(
                          ...summary.activities.map((item) => item.total),
                          1,
                        );
                        const barHeight = Math.max(2, Math.round((day.total / maximum) * 100));
                        const dateLabel = formatChartDate(day.date);
                        const detail =
                          dateLabel +
                          '؛ شعب: ' +
                          formatNumber(day.branches) +
                          '، دستگاه‌ها: ' +
                          formatNumber(day.devices) +
                          '، وضعیت دستگاه‌ها: ' +
                          formatNumber(day.health);

                        return (
                          <div
                            aria-label={detail}
                            className={styles.chartColumn}
                            key={day.date}
                            role="listitem"
                            title={detail}
                          >
                            <span aria-hidden="true" className={styles.chartValue}>
                              {formatNumber(day.total)}
                            </span>
                            <span aria-hidden="true" className={styles.chartTrack}>
                              {day.total > 0 && (
                                <span
                                  className={styles.chartBar}
                                  style={{ height: barHeight + '%' }}
                                >
                                  {day.branches > 0 && (
                                    <span
                                      className={styles.chartSegment + ' ' + styles.segmentBranch}
                                      style={{ height: (day.branches / day.total) * 100 + '%' }}
                                    />
                                  )}
                                  {day.devices > 0 && (
                                    <span
                                      className={styles.chartSegment + ' ' + styles.segmentDevice}
                                      style={{ height: (day.devices / day.total) * 100 + '%' }}
                                    />
                                  )}
                                  {day.health > 0 && (
                                    <span
                                      className={styles.chartSegment + ' ' + styles.segmentHealth}
                                      style={{ height: (day.health / day.total) * 100 + '%' }}
                                    />
                                  )}
                                </span>
                              )}
                            </span>
                            <span aria-hidden="true" className={styles.chartLabel}>
                              {showDateLabel(index, summary.activities.length, selectedDays)
                                ? dateLabel
                                : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className={styles.chartFooter}>
                    <div className={styles.chartLegend} aria-label="راهنمای نمودار">
                      <span>
                        <i className={styles.legendBranch} /> شعب
                      </span>
                      <span>
                        <i className={styles.legendDevice} /> دستگاه‌ها
                      </span>
                      <span>
                        <i className={styles.legendHealth} /> وضعیت دستگاه‌ها
                      </span>
                    </div>
                    {selectedDays === 90 && (
                      <span className={styles.chartHint}>
                        برای دیدن روزهای بیشتر، نمودار را بکشید.
                      </span>
                    )}
                  </div>
                </>
              )}
            </Surface>

            <Surface className={styles.healthPanel}>
              <PanelHeading
                eyebrow="وضعیت فعلی"
                title="سلامت دستگاه‌ها"
                description="آخرین وضعیت ثبت‌شده برای دستگاه‌های این محدوده"
                icon={<DeviceIcon />}
              />
              {summary.devices.total === 0 ? (
                <EmptyState
                  className={styles.healthEmpty}
                  icon={<DeviceIcon />}
                  title="هنوز دستگاهی ثبت نشده است"
                  description="پس از ثبت دستگاه‌ها، وضعیت آن‌ها در همین بخش نمایش داده می‌شود."
                />
              ) : summary.healthTotal === 0 ? (
                <EmptyState
                  className={styles.healthEmpty}
                  icon={<ActivityIcon />}
                  title="وضعیت دستگاه‌ها در دسترس نیست"
                  description="به‌محض ثبت وضعیت دستگاه‌ها، جزئیات اینجا دیده می‌شود."
                />
              ) : (
                <>
                  <div className={styles.healthOverview}>
                    <div className={styles.healthPercent}>
                      <strong>
                        {formatPercent(summary.devices.total, summary.devices.health.online)}٪
                      </strong>
                      <span>دستگاه آنلاین</span>
                    </div>
                    <span className={styles.healthTotal}>
                      از {formatNumber(summary.devices.total)} دستگاه
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
                      label="نیازمند بررسی"
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
                </>
              )}
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

          {scope.type === 'organization' && (
            <Surface className={styles.branchesPanel}>
              <PanelHeading
                eyebrow="نمای شعب"
                title="وضعیت شعب"
                description="وضعیت هر شعبه و دستگاه‌های آنلاین آن را ببینید"
                icon={<BranchIcon />}
              />

              {currentReport.snapshot.branchBreakdown.length === 0 ? (
                <EmptyState
                  className={styles.branchEmpty}
                  icon={<BranchIcon />}
                  title="اطلاعاتی از شعب برای نمایش نیست"
                  description="پس از ثبت شعب، وضعیت و دستگاه‌های هرکدام در این بخش دیده می‌شود."
                />
              ) : (
                <>
                  <div className={styles.branchList}>
                    {currentReport.snapshot.branchBreakdown.slice(0, 6).map((branch) => (
                      <BranchRow key={branch.branchId} branch={branch} />
                    ))}
                  </div>
                  {(currentReport.snapshot.branchBreakdownTruncated ||
                    currentReport.snapshot.branchBreakdown.length > 6) && (
                    <p className={styles.truncationNotice}>
                      برای دیدن وضعیت همهٔ شعب، فهرست کامل را باز کنید.
                    </p>
                  )}
                </>
              )}

              <Button
                className={styles.branchAction}
                onClick={() => onNavigate('branches')}
                tone="ghost"
                type="button"
              >
                نمایش فهرست شعب <ArrowIcon />
              </Button>
            </Surface>
          )}

          <footer className={styles.reportMeta}>
            <span>
              <ClockIcon />
              آخرین به‌روزرسانی: {formatDate(currentReport.projection.asOf)}
            </span>
            <span>
              <CalendarIcon />
              {currentReport.projection.coverageStartedAt
                ? 'نمایش اطلاعات از ' + formatDate(currentReport.projection.coverageStartedAt)
                : 'اطلاعات قدیمی‌تر برای نمایش در دسترس نیست'}
            </span>
          </footer>
        </>
      )}
    </div>
  );
}

function LoadingDashboard() {
  return (
    <section className={styles.loadingSection} role="status" aria-live="polite">
      <span className={styles.srOnly}>در حال آماده‌سازی نمای کلی</span>
      <div className={styles.loadingMetrics} aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <Surface className={styles.skeletonCard} key={item}>
            <span className={styles.skeletonIcon} />
            <span className={styles.skeletonTitle} />
            <span className={styles.skeletonValue} />
            <span className={styles.skeletonLine} />
          </Surface>
        ))}
      </div>
      <div className={styles.loadingPanels} aria-hidden="true">
        <Surface className={styles.skeletonPanel}>
          <span className={styles.skeletonTitle} />
          <span className={styles.skeletonChart} />
        </Surface>
        <Surface className={styles.skeletonPanel}>
          <span className={styles.skeletonTitle} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
        </Surface>
      </div>
    </section>
  );
}

function DeviceStatus({
  attention,
  online,
  total,
}: {
  attention: number;
  online: number;
  total: number;
}) {
  const status =
    total === 0
      ? { label: 'هنوز دستگاهی ثبت نشده', tone: 'neutral' }
      : attention > 0
        ? { label: formatNumber(attention) + ' دستگاه نیاز به رسیدگی دارد', tone: 'warning' }
        : online === total
          ? { label: 'همهٔ دستگاه‌ها آنلاین هستند', tone: 'good' }
          : { label: 'وضعیت دستگاه‌ها را مرور کنید', tone: 'neutral' };

  return (
    <div className={styles.deviceStatus + ' ' + styles['status_' + status.tone]}>
      <span aria-hidden="true" className={styles.statusDot} />
      <span>{status.label}</span>
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
  tone: 'teal' | 'blue' | 'orange' | 'green' | 'calm';
  emphasized?: boolean;
}) {
  return (
    <Surface
      className={
        styles.metricCard +
        ' ' +
        styles['metric_' + tone] +
        (emphasized ? ' ' + styles.metricEmphasized : '')
      }
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

function PanelHeading({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className={styles.panelHeading}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <span className={styles.panelIcon} aria-hidden="true">
        {icon}
      </span>
    </div>
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
  tone: 'green' | 'orange' | 'red' | 'purple' | 'gray';
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className={styles.healthRow}>
      <div className={styles.healthRowText}>
        <span className={styles.healthLabel}>
          <i className={styles['healthDot_' + tone]} />
          {label}
        </span>
        <strong>{formatNumber(value)}</strong>
      </div>
      <span
        className={styles.healthTrack}
        role="img"
        aria-label={label + ': ' + formatNumber(value) + ' از ' + formatNumber(total) + ' دستگاه'}
      >
        <span
          className={styles.healthValue + ' ' + styles['health_' + tone]}
          style={{ width: percent + '%' }}
        />
      </span>
    </div>
  );
}

function BranchRow({
  branch,
}: {
  branch: OperationsReport['snapshot']['branchBreakdown'][number];
}) {
  const attention = branch.degraded + branch.offline + branch.stale + branch.unknown;
  const statusLabels = {
    active: 'فعال',
    suspended: 'غیرفعال',
    archived: 'بایگانی‌شده',
  };
  const onlinePercent =
    branch.devicesTotal > 0
      ? Math.min(100, Math.round((branch.online / branch.devicesTotal) * 100))
      : 0;

  return (
    <div className={styles.branchRow}>
      <span className={styles.branchMark} aria-hidden="true">
        <BranchIcon />
      </span>
      <div className={styles.branchIdentity}>
        <strong>{branch.branchName || 'شعبه بدون نام'}</strong>
        <span className={styles.branchState + ' ' + styles['branchState_' + branch.status]}>
          {statusLabels[branch.status]}
        </span>
      </div>
      <div className={styles.branchDevices}>
        <div className={styles.branchDeviceCopy}>
          <span>
            {branch.devicesTotal === 0
              ? 'هنوز دستگاهی ثبت نشده'
              : formatNumber(branch.online) +
                ' از ' +
                formatNumber(branch.devicesTotal) +
                ' دستگاه آنلاین'}
          </span>
          {attention > 0 && <small>{formatNumber(attention)} دستگاه نیازمند رسیدگی</small>}
        </div>
        <span
          aria-label={
            'دستگاه‌های آنلاین: ' +
            formatNumber(branch.online) +
            ' از ' +
            formatNumber(branch.devicesTotal)
          }
          className={styles.branchTrack}
          role="img"
        >
          <span style={{ width: onlinePercent + '%' }} />
        </span>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={styles.emptyState + (className ? ' ' + className : '')}>
      <span aria-hidden="true" className={styles.emptyIcon}>
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function activityForDay(row: OperationsDailyReportRow) {
  const branches = row.branchesCreated + row.branchStatusChanges;
  const devices = row.devicesRegistered + row.deviceUpdates;
  const health = row.healthOnline + row.healthDegraded + row.healthOffline;
  return { date: row.date, branches, devices, health, total: branches + devices + health };
}

function matchesScope(report: OperationsReport, scope: OperationsScope) {
  return (
    report.scope.scopeType === scope.type &&
    report.scope.organizationId.toLowerCase() === scope.organizationId.toLowerCase() &&
    (report.scope.branchId?.toLowerCase() ?? null) ===
      (scope.type === 'branch' ? scope.branchId.toLowerCase() : null)
  );
}

function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403)
      return 'برای دیدن این اطلاعات دسترسی ندارید. از مدیر مجموعه کمک بگیرید.';
    if (failure.status === 503) return 'اطلاعات موقتاً آماده نیست. کمی بعد دوباره تلاش کنید.';
    if (failure.status === 0) return 'اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.';
  }
  if (failure instanceof Error && failure.message === 'REPORT_MISMATCH') {
    return 'اطلاعات این صفحه به‌روز نیست. دوباره تلاش کنید.';
  }
  return 'بارگذاری اطلاعات انجام نشد. دوباره تلاش کنید.';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fa-IR').format(value);
}

function formatPercent(total: number, value: number) {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'زمان نامشخص'
    : new Intl.DateTimeFormat('fa-IR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(date);
}

function formatChartDate(value: string) {
  const date = new Date(value + 'T12:00:00.000Z');
  return Number.isNaN(date.valueOf())
    ? 'تاریخ نامشخص'
    : new Intl.DateTimeFormat('fa-IR', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(date);
}

function showDateLabel(index: number, length: number, days: PeriodDays) {
  const step = days === 7 ? 1 : days === 30 ? 5 : 10;
  return index === 0 || index === length - 1 || index % step === 0;
}

function OverviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 13.5V20h6v-6.5H4ZM14 4v6h6V4h-6ZM4 4v6h6V4H4ZM14 13.5V20h6v-6.5h-6Z" />
    </svg>
  );
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
function WifiIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 9a11 11 0 0 1 14 0M8 12a6.5 6.5 0 0 1 8 0M10.5 15a2.5 2.5 0 0 1 3 0M12 19h.01" />
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
function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}
