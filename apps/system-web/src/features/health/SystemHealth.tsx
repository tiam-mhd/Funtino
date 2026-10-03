'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, FuntinoMark, Surface } from '@funtino/design-system';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
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

export function SystemHealth() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

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

  const pageStale = Boolean(snapshot && error);

  return (
    <main className={styles.page} aria-busy={loading || refreshing}>
      <header className={styles.topbar}>
        <FuntinoMark />
        <a href="/fa" className={styles.homeLink}>
          بازگشت به نمای کلی
        </a>
      </header>

      <div className={styles.content}>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>کنترل سامانه · دسترسی سراسری</span>
            <h1>پایش عملیاتی</h1>
            <p>نمای تجمیعی از دسترس‌پذیری سرویس‌ها، خطای HTTP، تاخیر و صف پیام.</p>
          </div>
          <Button
            type="button"
            tone="secondary"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'در حال همگام‌سازی…' : 'به‌روزرسانی'}
          </Button>
        </div>

        {loading && !snapshot && (
          <p className={styles.feedback} role="status" aria-live="polite">
            در حال دریافت telemetry مجاز…
          </p>
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

            <section className={styles.serviceGrid} aria-label="وضعیت سرویس‌ها">
              {snapshot.services.map((service) => (
                <Surface className={styles.serviceCard} key={service.key}>
                  <div className={styles.serviceHeading}>
                    <div>
                      <h2>{service.name}</h2>
                      <small>
                        {numberLabel(service.targets, 0)} هدف ·{' '}
                        {numberLabel(service.unavailableTargets, 0)} غیرقابل‌دسترسی
                      </small>
                    </div>
                    <Badge tone={statusTones[service.status]}>{statusLabels[service.status]}</Badge>
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
              ))}
            </section>

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
                  {snapshot.activeAlerts.map((alert) => (
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
            <p className={styles.footnote}>
              داده‌ها تجمیعی‌اند و شامل نشانی target، درخواست دلخواه PromQL یا اطلاعات مشتری نیستند.
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
    </main>
  );
}
