'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Surface } from '@funtino/design-system';
import { ApiRequestError } from '../../lib/api/client';
import {
  confirmOperationsMfaEnrollment,
  getOperationsMfaStatus,
  startOperationsMfaEnrollment,
  verifyOperationsMfaStepUp,
  type OperationsMfaEnrollment,
  type OperationsMfaRecoveryCodes,
  type OperationsMfaStatus,
} from '../../lib/api/operations-staff';
import {
  exportOperationsReport,
  getOperationsReport,
  type OperationsDailyReportRow,
  type OperationsReport,
} from '../../lib/api/operations-reports';
import { normalizeDigits, scopeKey, type OperationsScope } from '../../lib/auth/operations-access';
import styles from './OperationsReports.module.css';

type Props = {
  scope: OperationsScope;
  onSessionExpired: () => void;
  mfaStepUpUntil: number | null;
  onMfaStepUp: (validUntil: number) => void;
};
type MfaStage = 'verify' | 'enroll' | 'confirm' | 'recovery';

const metricLabels: Array<{ key: keyof Omit<OperationsDailyReportRow, 'date'>; label: string }> = [
  { key: 'branchesCreated', label: 'شعبه ایجادشده' },
  { key: 'branchStatusChanges', label: 'تغییر وضعیت شعبه' },
  { key: 'devicesRegistered', label: 'دستگاه ثبت‌شده' },
  { key: 'deviceUpdates', label: 'به‌روزرسانی دستگاه' },
  { key: 'healthOnline', label: 'مشاهده آنلاین' },
  { key: 'healthDegraded', label: 'مشاهده اختلال' },
  { key: 'healthOffline', label: 'مشاهده آفلاین' },
];

export function OperationsReports({ scope, onSessionExpired, mfaStepUpUntil, onMfaStepUp }: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultFrom = useMemo(() => {
    const value = new Date(`${today}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 29);
    return value.toISOString().slice(0, 10);
  }, [today]);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ from: defaultFrom, to: today });
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState<MfaStage | null>(null);
  const [mfaStatus, setMfaStatus] = useState<OperationsMfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<OperationsMfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<OperationsMfaRecoveryCodes | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [method, setMethod] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const activeScopeKey = scopeKey(scope);

  const loadReport = useCallback(
    async (range: { from: string; to: string }) => {
      setLoading(true);
      setError('');
      setNotice('');
      try {
        const nextReport = await getOperationsReport(scope, range.from, range.to);
        if (
          nextReport.scope.scopeType !== scope.type ||
          nextReport.scope.organizationId.toLowerCase() !== scope.organizationId.toLowerCase() ||
          (nextReport.scope.branchId?.toLowerCase() ?? null) !==
            (scope.type === 'branch' ? scope.branchId.toLowerCase() : null)
        )
          throw new Error('SCOPE_MISMATCH');
        setReport(nextReport);
        setAppliedRange(range);
      } catch (failure) {
        if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
        else setError(messageFor(failure));
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [onSessionExpired, scope],
  );

  useEffect(() => {
    void loadReport({ from: defaultFrom, to: today });
  }, [activeScopeKey, defaultFrom, today, loadReport]);

  async function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    const days = (toDate.getTime() - fromDate.getTime()) / 86_400_000 + 1;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 366 ||
      to > today
    ) {
      setError('بازه باید معتبر، حداکثر ۳۶۶ روز و بدون تاریخ آینده باشد.');
      return;
    }
    await loadReport({ from, to });
  }

  async function downloadReport() {
    if (!report?.capabilities.canExport || exporting) return;
    if (!mfaStepUpUntil || mfaStepUpUntil <= Date.now()) {
      await openMfa();
      return;
    }
    await performExport(appliedRange);
  }

  async function openMfa() {
    setMfaBusy(true);
    setMfaError('');
    try {
      const status = await getOperationsMfaStatus();
      setMfaStatus(status);
      setStage(status.enabled ? 'verify' : 'enroll');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else {
        const message = messageFor(failure);
        setMfaError(message);
        setError(message);
      }
    } finally {
      setMfaBusy(false);
    }
  }

  async function beginEnrollment() {
    setMfaBusy(true);
    setMfaError('');
    try {
      setEnrollment(await startOperationsMfaEnrollment());
      setCode('');
      setStage('confirm');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized =
      method === 'totp'
        ? normalizeDigits(code).replace(/\D/g, '')
        : normalizeDigits(code).trim().toUpperCase();
    if (
      method === 'totp'
        ? !/^\d{6}$/.test(normalized)
        : !/^[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/.test(normalized)
    ) {
      setMfaError(method === 'totp' ? 'کد رمزساز باید ۶ رقم باشد.' : 'قالب کد بازیابی معتبر نیست.');
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      const proof = await verifyOperationsMfaStepUp({ method, code: normalized });
      onMfaStepUp(Date.parse(proof.validUntil));
      setStage(null);
      setCode('');
      await performExport(appliedRange);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeDigits(code).replace(/\D/g, '');
    if (!/^\d{6}$/.test(normalized)) {
      setMfaError('کد رمزساز باید ۶ رقم باشد.');
      return;
    }
    setMfaBusy(true);
    setMfaError('');
    try {
      const result = await confirmOperationsMfaEnrollment(normalized);
      onMfaStepUp(Date.parse(result.validUntil));
      setRecoveryCodes(result);
      setRecoverySaved(false);
      setMfaStatus({
        enabled: true,
        enrollmentPending: false,
        recoveryCodesRemaining: result.recoveryCodes.length,
      });
      setStage('recovery');
      setCode('');
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setMfaError(messageFor(failure));
    } finally {
      setMfaBusy(false);
    }
  }

  async function finishEnrollmentAndExport() {
    if (!recoverySaved || !recoveryCodes) return;
    setStage(null);
    await performExport(appliedRange);
    setRecoveryCodes(null);
    setRecoverySaved(false);
  }

  async function performExport(range: { from: string; to: string }) {
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const result = await exportOperationsReport(scope, range.from, range.to);
      if (
        result.period.from !== range.from ||
        result.period.to !== range.to ||
        result.daily.length > 366
      )
        throw new Error('EXPORT_CONTRACT_MISMATCH');
      downloadCsv(result.daily, range.from, range.to);
      setNotice(`گزارش ${toPersianDigits(result.daily.length)} ردیفی با ثبت audit دریافت شد.`);
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) onSessionExpired();
      else setError(messageFor(failure));
    } finally {
      setExporting(false);
    }
  }

  const maxHealthCount = Math.max(1, report?.snapshot.devices.total ?? 0);
  return (
    <section className={styles.page} aria-labelledby="operations-reports-title">
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>گزارش فقط‌خواندنی و scope‌دار</div>
          <h2 id="operations-reports-title">گزارش‌های عملیاتی</h2>
          <p>داده‌ی تجمیعی شعب و سلامت دستگاه‌ها؛ بدون اطلاعات تماس، عضو یا مانده‌ی مالی.</p>
        </div>
        <Button
          type="button"
          tone="secondary"
          disabled={loading}
          onClick={() => void loadReport(appliedRange)}
        >
          {loading ? 'در حال دریافت…' : 'تازه‌سازی'}
        </Button>
      </div>

      <Surface className={styles.filters}>
        <form className={styles.filterForm} onSubmit={(event) => void applyRange(event)}>
          <label htmlFor="report-from">
            از تاریخ
            <input
              id="report-from"
              type="date"
              max={today}
              required
              value={from}
              onChange={(event) => setFrom(event.currentTarget.value)}
            />
          </label>
          <label htmlFor="report-to">
            تا تاریخ
            <input
              id="report-to"
              type="date"
              max={today}
              required
              value={to}
              onChange={(event) => setTo(event.currentTarget.value)}
            />
          </label>
          <div className={styles.filterActions}>
            <Button type="submit" disabled={loading}>
              اعمال بازه
            </Button>
            <Button
              type="button"
              tone="ghost"
              disabled={exporting || !report?.capabilities.canExport}
              onClick={() => void downloadReport()}
            >
              {exporting ? 'در حال آماده‌سازی…' : 'خروجی CSV امن'}
            </Button>
          </div>
        </form>
        <p className={styles.helper}>
          روزهای انتخابی بر پایه‌ی UTC محاسبه می‌شوند؛ حداکثر بازه ۳۶۶ روز است.
        </p>
      </Surface>

      {loading && !report && (
        <Surface className={styles.state} role="status" aria-live="polite">
          در حال بارگذاری projection گزارش…
        </Surface>
      )}
      {error && (
        <Surface className={styles.error} role="alert">
          <p>{error}</p>
          <Button type="button" tone="ghost" onClick={() => void loadReport(appliedRange)}>
            تلاش دوباره
          </Button>
        </Surface>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {report && !loading && (
        <>
          <Surface className={styles.coverage} role="note">
            <strong>پوشش و تازگی projection</strong>
            {report.projection.coverageStartedAt ? (
              <p>
                ثبت رویدادها از {formatDate(report.projection.coverageStartedAt)} · آخرین رویداد{' '}
                {report.projection.lastEventAt
                  ? formatDate(report.projection.lastEventAt)
                  : 'ندارد'}{' '}
                · آخرین پردازش{' '}
                {report.projection.lastProcessedAt
                  ? formatDate(report.projection.lastProcessedAt)
                  : 'ندارد'}
              </p>
            ) : (
              <p>
                هنوز رویداد عملیاتی معتبری دریافت نشده؛ صفرها را نبود فعالیت قطعی تلقی نکنید. پوشش
                تاریخی پیش از راه‌اندازی consumer در دسترس نیست.
              </p>
            )}
            {report.projection.coverageStartedAt &&
              Date.parse(`${appliedRange.from}T00:00:00.000Z`) <
                Date.parse(report.projection.coverageStartedAt) && (
                <p className={styles.coverageWarning} role="alert">
                  بخشی از بازه پیش از شروع جمع‌آوری رویدادهاست؛ حتی اگر روز آغاز یکسان باشد،
                  داده‌های قبل از زمان شروع پوشش داده نشده‌اند.
                </p>
              )}
            <p>
              وضعیت گزارش در {formatDate(report.projection.asOf)} · نسل projection{' '}
              <code dir="ltr">{report.projection.generationId.slice(0, 8)}</code>
            </p>
          </Surface>

          {!report.capabilities.canExport && (
            <p className={styles.helper}>
              برای این محدوده مجوز report.export ندارید؛ امکان دریافت فایل فعال نیست.
            </p>
          )}
          <div className={styles.metricsGrid}>
            <MetricCard
              title="شعب در projection"
              value={
                report.snapshot.branches.active +
                report.snapshot.branches.suspended +
                report.snapshot.branches.archived
              }
              detail={`فعال ${report.snapshot.branches.active} · تعلیق ${report.snapshot.branches.suspended} · آرشیو ${report.snapshot.branches.archived}`}
            />
            <MetricCard
              title="دستگاه‌های ثبت‌شده"
              value={report.snapshot.devices.total}
              detail={`فعال ${report.snapshot.devices.active} · تعلیق ${report.snapshot.devices.suspended} · بازنشسته ${report.snapshot.devices.retired}`}
            />
            <MetricCard
              title="نیازمند پیگیری"
              value={
                report.snapshot.devices.health.offline +
                report.snapshot.devices.health.stale +
                report.snapshot.devices.health.degraded
              }
              detail={`آفلاین ${report.snapshot.devices.health.offline} · کهنه ${report.snapshot.devices.health.stale} · مختل ${report.snapshot.devices.health.degraded}`}
              tone="warning"
            />
            <MetricCard
              title="تازگی نامشخص"
              value={report.snapshot.devices.health.unknown}
              detail={`چرخه‌عمر ناشناخته ${report.snapshot.devices.unknownLifecycle}`}
            />
          </div>

          <Surface className={styles.periodSummary}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>رویدادهای بازه</h3>
                <p>
                  {report.period.from} تا {report.period.to} · {toPersianDigits(report.period.days)}{' '}
                  روز
                </p>
              </div>
              <Badge tone="neutral">UTC</Badge>
            </div>
            <div className={styles.totalGrid}>
              {metricLabels.map(({ key, label }) => (
                <div key={key}>
                  <span>{label}</span>
                  <strong>{toPersianDigits(report.totals[key])}</strong>
                </div>
              ))}
            </div>
          </Surface>

          {scope.type === 'organization' && (
            <Surface className={styles.branchPanel}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3>مقایسه‌ی شعب</h3>
                  <p>وضعیت جاری دستگاه‌ها؛ نه عملکرد مالی یا مراجعه.</p>
                </div>
              </div>
              {report.snapshot.branchBreakdown.length === 0 ? (
                <p className={styles.empty}>در projection شعبه‌ای برای این محدوده ثبت نشده است.</p>
              ) : (
                <div
                  className={styles.tableScroller}
                  role="region"
                  aria-label="جدول مقایسه‌ی شعب؛ پیمایش افقی"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">شعبه</th>
                        <th scope="col">وضعیت</th>
                        <th scope="col">دستگاه</th>
                        <th scope="col">آنلاین</th>
                        <th scope="col">مختل</th>
                        <th scope="col">کهنه/آفلاین</th>
                        <th scope="col">نامشخص</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.snapshot.branchBreakdown.map((branch) => (
                        <tr key={branch.branchId}>
                          <th scope="row">
                            {branch.branchName ?? `شعبه ${branch.branchId.slice(0, 8)}`}
                          </th>
                          <td>{branchStatusLabel[branch.status]}</td>
                          <td>{toPersianDigits(branch.devicesTotal)}</td>
                          <td>{toPersianDigits(branch.online)}</td>
                          <td>{toPersianDigits(branch.degraded)}</td>
                          <td>{toPersianDigits(branch.stale + branch.offline)}</td>
                          <td>{toPersianDigits(branch.unknown)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {report.snapshot.branchBreakdownTruncated && (
                <p className={styles.helper}>
                  نمایش به ۵۰۰ شعبه‌ی نخست محدود شده؛ این جدول برای محدوده‌های بزرگ کامل نیست.
                </p>
              )}
            </Surface>
          )}

          <Surface className={styles.periodSummary}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>روند روزانه</h3>
                <p>شمار رویدادهای معتبر، نه تعداد مشتری یکتا.</p>
              </div>
            </div>
            <div
              className={styles.tableScroller}
              role="region"
              aria-label="جدول روند روزانه؛ پیمایش افقی"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">روز UTC</th>
                    {metricLabels.map(({ key, label }) => (
                      <th scope="col" key={key}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((row) => (
                    <tr key={row.date}>
                      <th scope="row">{row.date}</th>
                      {metricLabels.map(({ key }) => (
                        <td key={key}>{toPersianDigits(row[key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <div className={styles.healthPanel} aria-label="توزیع سلامت جاری دستگاه‌ها">
            {healthMetric(
              'آنلاین',
              report.snapshot.devices.health.online,
              maxHealthCount,
              'success',
            )}
            {healthMetric(
              'دارای اختلال',
              report.snapshot.devices.health.degraded,
              maxHealthCount,
              'warning',
            )}
            {healthMetric(
              'داده کهنه',
              report.snapshot.devices.health.stale,
              maxHealthCount,
              'warning',
            )}
            {healthMetric(
              'آفلاین',
              report.snapshot.devices.health.offline,
              maxHealthCount,
              'danger',
            )}
            {healthMetric(
              'نامشخص',
              report.snapshot.devices.health.unknown,
              maxHealthCount,
              'neutral',
            )}
          </div>
        </>
      )}

      {stage && (
        <Surface className={styles.mfaPanel} aria-labelledby="report-export-mfa-title">
          <div className={styles.sectionHeading}>
            <div>
              <h3 id="report-export-mfa-title">تأیید MFA برای دریافت فایل</h3>
              <p>مجوز export و تازگی MFA در سرور دوباره کنترل می‌شوند.</p>
            </div>
            <Button tone="ghost" type="button" onClick={() => setStage(null)}>
              انصراف
            </Button>
          </div>
          {mfaError && (
            <p className={styles.errorText} role="alert">
              {mfaError}
            </p>
          )}
          {stage === 'verify' && (
            <form className={styles.mfaForm} onSubmit={(event) => void verifyStepUp(event)}>
              <label htmlFor="report-mfa-method">
                روش تأیید
                <select
                  id="report-mfa-method"
                  value={method}
                  onChange={(event) => setMethod(event.currentTarget.value as 'totp' | 'recovery')}
                >
                  <option value="totp">کد برنامه‌ی رمزساز</option>
                  <option value="recovery">کد بازیابی یک‌بارمصرف</option>
                </select>
              </label>
              <label htmlFor="report-mfa-code">
                {method === 'totp' ? 'کد ۶ رقمی' : 'کد بازیابی'}
                <input
                  id="report-mfa-code"
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode={method === 'totp' ? 'numeric' : 'text'}
                  maxLength={method === 'totp' ? 6 : 35}
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  required
                />
              </label>
              <Button type="submit" disabled={mfaBusy}>
                {mfaBusy ? 'در حال تأیید…' : 'تأیید و دریافت خروجی'}
              </Button>
            </form>
          )}
          {stage === 'enroll' && (
            <div className={styles.mfaForm}>
              <p>
                برای دریافت خروجی مدیریتی، ابتدا MFA را با برنامه‌ی رمزساز فعال کنید؛ OTP پیامکی
                جایگزین آن نیست.
              </p>
              <Button type="button" disabled={mfaBusy} onClick={() => void beginEnrollment()}>
                {mfaBusy
                  ? 'در حال آماده‌سازی…'
                  : mfaStatus?.enrollmentPending
                    ? 'ادامه‌ی راه‌اندازی MFA'
                    : 'راه‌اندازی MFA'}
              </Button>
            </div>
          )}
          {stage === 'confirm' && enrollment && (
            <form className={styles.mfaForm} onSubmit={(event) => void confirmEnrollment(event)}>
              <p>
                کلید را فقط در برنامه‌ی رمزساز خود وارد کنید. این مقدار در مرورگر ذخیره نمی‌شود.
              </p>
              <code dir="ltr" className={styles.secret}>
                {enrollment.secret}
              </code>
              <label htmlFor="report-mfa-enrollment-code">
                کد برنامه‌ی رمزساز
                <input
                  id="report-mfa-enrollment-code"
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  required
                />
              </label>
              <Button type="submit" disabled={mfaBusy}>
                {mfaBusy ? 'در حال فعال‌سازی…' : 'فعال‌سازی MFA'}
              </Button>
            </form>
          )}
          {stage === 'recovery' && recoveryCodes && (
            <div className={styles.mfaForm}>
              <p className={styles.warning}>
                کدهای بازیابی فقط همین بار نمایش داده می‌شوند؛ آن‌ها را در محل امن ذخیره کنید.
              </p>
              <ol className={styles.recoveryCodes} dir="ltr">
                {recoveryCodes.recoveryCodes.map((item) => (
                  <li key={item}>
                    <code>{item}</code>
                  </li>
                ))}
              </ol>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={recoverySaved}
                  onChange={(event) => setRecoverySaved(event.currentTarget.checked)}
                />
                کدها را ذخیره کردم
              </label>
              <Button
                type="button"
                disabled={!recoverySaved || mfaBusy}
                onClick={() => void finishEnrollmentAndExport()}
              >
                ادامه و دریافت خروجی
              </Button>
            </div>
          )}
        </Surface>
      )}
    </section>
  );
}

function MetricCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string;
  value: number;
  detail: string;
  tone?: 'warning';
}) {
  return (
    <Surface className={styles.metricCard}>
      <span>{title}</span>
      <strong className={tone === 'warning' ? styles.warningValue : ''}>
        {toPersianDigits(value)}
      </strong>
      <small>{detail}</small>
    </Surface>
  );
}

function healthMetric(
  label: string,
  value: number,
  total: number,
  tone: 'success' | 'warning' | 'danger' | 'neutral',
) {
  const percent = Math.min(100, Math.round((value / total) * 100));
  return (
    <Surface className={styles.healthItem} key={label}>
      <div>
        <span>{label}</span>
        <strong>{toPersianDigits(value)}</strong>
      </div>
      <div
        className={styles.barTrack}
        role="img"
        aria-label={`${label}: ${toPersianDigits(value)} دستگاه`}
      >
        <span className={styles[`bar_${tone}`]} style={{ width: `${percent}%` }} />
      </div>
    </Surface>
  );
}

function downloadCsv(rows: OperationsDailyReportRow[], from: string, to: string) {
  const headers = ['روز UTC', ...metricLabels.map(({ label }) => label)];
  const lines = [
    headers,
    ...rows.map((row) => [row.date, ...metricLabels.map(({ key }) => String(row[key]))]),
  ].map((line) => line.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `funtino-operations-${from}-${to}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
function toPersianDigits(value: number) {
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
function messageFor(failure: unknown) {
  if (failure instanceof ApiRequestError) {
    if (failure.status === 403)
      return 'برای این scope یا دریافت فایل مجوز لازم را ندارید؛ permissionها در سرور بررسی می‌شوند.';
    if (failure.status === 400)
      return 'بازه‌ی گزارش معتبر نیست؛ حداکثر ۳۶۶ روز و بدون تاریخ آینده انتخاب کنید.';
    if (failure.status === 503)
      return 'سرویس گزارش یا یکی از مالک‌های داده در دسترس نیست؛ نتیجه‌ی قبلی را تازه فرض نکنید.';
    if (failure.status === 0) return 'اتصال برقرار نشد. شبکه را بررسی و دوباره تلاش کنید.';
    return failure.message;
  }
  if (failure instanceof Error && failure.message === 'SCOPE_MISMATCH')
    return 'scope پاسخ گزارش با محدوده‌ی انتخاب‌شده هماهنگ نیست؛ نمایش داده متوقف شد.';
  if (failure instanceof Error && failure.message === 'EXPORT_CONTRACT_MISMATCH')
    return 'بازه‌ی فایل با درخواست تطبیق نداشت؛ فایل ساخته نشد.';
  return 'گزارش آماده نشد. دوباره تلاش کنید.';
}

const branchStatusLabel = { active: 'فعال', suspended: 'تعلیق', archived: 'آرشیو' } as const;
