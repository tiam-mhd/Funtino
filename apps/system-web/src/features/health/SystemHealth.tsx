'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import { ManagementListPage } from '../../components/system-shell/ManagementListPage';
import styles from './SystemHealth.module.css';

type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'stale' | 'unknown';
type AlertSeverity = 'critical' | 'warning' | 'info';
type Service = {
  key: string;
  name: string;
  status: ServiceStatus;
  targets: number;
  unavailableTargets: number;
  requestsPerSecond: number | null;
  serverErrorPercent: number | null;
  p95LatencyMs: number | null;
  freshnessSeconds: number | null;
  lastScrapedAt: string | null;
};
type Alert = { name: string; service: string; severity: AlertSeverity };
type HealthSnapshot = {
  observedAt: string;
  source: 'prometheus';
  services: Service[];
  activeAlerts: Alert[];
};

const statusLabels: Record<ServiceStatus, string> = {
  healthy: 'سالم',
  degraded: 'مختل',
  down: 'قطع',
  stale: 'داده قدیمی',
  unknown: 'نامشخص',
};
const statusTones: Record<ServiceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
  stale: 'warning',
  unknown: 'neutral',
};
const severityLabels: Record<AlertSeverity, string> = {
  critical: 'بحرانی',
  warning: 'هشدار',
  info: 'اطلاع',
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 401) {
    return 'برای مشاهده‌ی پایش زنده، نشست مدیر سامانه لازم است.';
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return 'مجوز سراسری system.health.read برای این حساب فعال نیست.';
  }
  return 'منبع پایش در دسترس نیست؛ اتصال خصوصی Prometheus یا وضعیت Gateway را بررسی کنید.';
}

function dateLabel(value: string | null): string {
  if (!value) return 'هنوز داده‌ای دریافت نشده';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function numberLabel(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(value);
}

export function SystemHealth({ view = 'services' }: { view?: 'services' | 'alerts' }) {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await apiRequest<HealthSnapshot>('/api/v1/system/health');
      setSnapshot(next);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setPageNumber(1);
  }, [view]);

  const pageStale = Boolean(snapshot && error);
  const unavailableTargets =
    snapshot?.services.reduce((total, service) => total + service.unavailableTargets, 0) ?? 0;
  const currentItemCount =
    view === 'alerts' ? (snapshot?.activeAlerts.length ?? 0) : (snapshot?.services.length ?? 0);
  const visibleServices = snapshot?.services.slice((pageNumber - 1) * 25, pageNumber * 25) ?? [];
  const visibleAlerts = snapshot?.activeAlerts.slice((pageNumber - 1) * 25, pageNumber * 25) ?? [];
  const visibleItemCount = view === 'alerts' ? visibleAlerts.length : visibleServices.length;
  const listPagination = snapshot
    ? {
        page: pageNumber,
        itemCount: visibleItemCount,
        canGoPrevious: pageNumber > 1,
        canGoNext: pageNumber * 25 < currentItemCount,
        busy: refreshing,
        onPrevious: () => setPageNumber((current) => Math.max(1, current - 1)),
        onNext: () => setPageNumber((current) => current + 1),
      }
    : undefined;

  return (
    <main className={styles.page} aria-busy={loading || refreshing}>
      <ManagementListPage
        eyebrow="عملیات سامانه · نمای سراسری"
        title={view === 'alerts' ? 'هشدارهای فعال' : 'وضعیت سرویس‌ها'}
        description={
          view === 'alerts'
            ? 'هشدارهای فعال را از آخرین دریافت منبع پایش بررسی کنید.'
            : 'دسترس‌پذیری، خطای HTTP، تاخیر و تازگی scrape سرویس‌ها را ببینید.'
        }
        toolbarActions={
          <Button
            type="button"
            tone="secondary"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'در حال همگام‌سازی…' : 'به‌روزرسانی'}
          </Button>
        }
        pagination={listPagination}
      >
        <div className={styles.content}>
          {loading && !snapshot && (
            <LoadingSkeleton label="در حال دریافت وضعیت سرویس‌ها" rows={4} />
          )}

          {error && (
            <p
              className={pageStale ? styles.staleNotice : styles.errorNotice}
              role={pageStale ? 'status' : 'alert'}
            >
              {pageStale ? 'اتصال تازه نشد؛ داده‌های زیر ممکن است قدیمی باشند. ' : ''}
              {error}
            </p>
          )}

          {snapshot && (
            <>
              <div className={styles.summaryRow}>
                <Badge tone={pageStale ? 'warning' : 'info'}>
                  {pageStale ? 'نمای ذخیره‌شده · stale' : 'منبع: Prometheus'}
                </Badge>
                <span>آخرین دریافت: {dateLabel(snapshot.observedAt)}</span>
              </div>

              <section className={styles.overview} aria-label="خلاصه‌ی وضعیت پایش">
                <div>
                  <span>سرویس‌های دریافت‌شده</span>
                  <strong>{numberLabel(snapshot.services.length, 0)}</strong>
                </div>
                <div>
                  <span>هدف‌های در دسترس نیست</span>
                  <strong className={unavailableTargets ? styles.metricWarning : ''}>
                    {numberLabel(unavailableTargets, 0)}
                  </strong>
                </div>
                <div>
                  <span>هشدارهای فعال</span>
                  <strong className={snapshot.activeAlerts.length ? styles.metricWarning : ''}>
                    {numberLabel(snapshot.activeAlerts.length, 0)}
                  </strong>
                </div>
              </section>

              {view === 'services' && (
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>وضعیت سرویس‌ها</h2>
                    <p>شاخص‌ها فقط از telemetry مجاز Gateway نمایش داده می‌شوند.</p>
                  </div>
                  <span>{numberLabel(snapshot.services.length, 0)} سرویس</span>
                </div>
              )}

              {view === 'services' && (
                <section className={styles.serviceGrid} aria-label="وضعیت سرویس‌ها">
                  {snapshot.services.length === 0 ? (
                    <Surface className={`${styles.emptyAlerts} ${styles.noServices}`} role="status">
                      فهرست سرویسی از منبع پایش دریافت نشد. اتصال و پیکربندی Prometheus را بررسی
                      کنید.
                    </Surface>
                  ) : (
                    visibleServices.map((service) => (
                      <Surface className={styles.serviceCard} key={service.key}>
                        <div className={styles.serviceHeading}>
                          <div>
                            <h2>{service.name}</h2>
                            <small>
                              {numberLabel(service.targets, 0)} هدف ·{' '}
                              {numberLabel(service.unavailableTargets, 0)} غیرقابل‌دسترسی
                            </small>
                          </div>
                          <Badge tone={statusTones[service.status]}>
                            {statusLabels[service.status]}
                          </Badge>
                        </div>
                        <dl className={styles.metrics}>
                          <div>
                            <dt>درخواست / ثانیه</dt>
                            <dd>{numberLabel(service.requestsPerSecond, 2)}</dd>
                          </div>
                          <div>
                            <dt>خطای 5xx</dt>
                            <dd>
                              {service.serverErrorPercent === null
                                ? '—'
                                : `${numberLabel(service.serverErrorPercent, 2)}٪`}
                            </dd>
                          </div>
                          <div>
                            <dt>تاخیر p95</dt>
                            <dd>
                              {service.p95LatencyMs === null
                                ? '—'
                                : `${numberLabel(service.p95LatencyMs)} ms`}
                            </dd>
                          </div>
                          <div>
                            <dt>تازگی scrape</dt>
                            <dd>
                              {service.freshnessSeconds === null
                                ? '—'
                                : `${numberLabel(service.freshnessSeconds, 0)} ثانیه`}
                            </dd>
                          </div>
                        </dl>
                        <p className={styles.lastScrape}>
                          آخرین scrape: {dateLabel(service.lastScrapedAt)}
                        </p>
                      </Surface>
                    ))
                  )}
                </section>
              )}

              {view === 'alerts' && (
                <Surface className={styles.alertPanel}>
                  <div className={styles.panelHeading}>
                    <div>
                      <h2>هشدارهای فعال</h2>
                      <p>هشدارها فقط از ruleهای نسخه‌دار Funtino دریافت می‌شوند.</p>
                    </div>
                    <Badge tone={snapshot.activeAlerts.length ? 'warning' : 'success'}>
                      {numberLabel(snapshot.activeAlerts.length, 0)} فعال
                    </Badge>
                  </div>
                  {snapshot.activeAlerts.length === 0 ? (
                    <p className={styles.emptyAlerts}>هشدار فعالی از منبع پایش گزارش نشده است.</p>
                  ) : (
                    <ul className={styles.alertList}>
                      {visibleAlerts.map((alert) => (
                        <li key={`${alert.name}:${alert.service}`}>
                          <span>
                            <strong>{alert.name}</strong>
                            <small>{alert.service}</small>
                          </span>
                          <Badge tone={alert.severity === 'critical' ? 'danger' : 'warning'}>
                            {severityLabels[alert.severity]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Surface>
              )}
              <p className={styles.footnote}>
                داده‌ها تجمیعی‌اند و شامل نشانی target، درخواست دلخواه PromQL یا اطلاعات مشتری
                نیستند.
              </p>
            </>
          )}

          {!snapshot && !loading && (
            <Surface className={styles.failureCard}>
              <h2>داده‌ی زنده دریافت نشد</h2>
              <p>{error || 'پایش هنوز پاسخ معتبری ارائه نکرده است.'}</p>
              <Button
                type="button"
                tone="primary"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                تلاش دوباره
              </Button>
            </Surface>
          )}
        </div>
      </ManagementListPage>
    </main>
  );
}
