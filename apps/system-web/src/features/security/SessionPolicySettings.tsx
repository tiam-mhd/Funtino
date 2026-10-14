'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import styles from './SessionPolicySettings.module.css';

type SessionPolicy = { managementSessionTtlHours: number; policyVersion: number };

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'خواندن یا ذخیره‌ی تنظیم نشست انجام نشد. اتصال و دسترسی را بررسی کنید.';
}

export function SessionPolicySettings() {
  const [policy, setPolicy] = useState<SessionPolicy | null>(null);
  const [hours, setHours] = useState('12');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const policyChanged = Boolean(policy && Number(hours) !== policy.managementSessionTtlHours);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest<SessionPolicy>('/api/v1/system/security/session-policy');
      setPolicy(result);
      setHours(String(result.managementSessionTtlHours));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<SessionPolicy>('/api/v1/system/security/session-policy', {
        method: 'PUT',
        headers: {
          'If-Match': `"${policy.policyVersion}"`,
          'Idempotency-Key': idempotencyKey(),
        },
        body: {
          managementSessionTtlHours: Number(hours),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      setPolicy(result);
      setHours(String(result.managementSessionTtlHours));
      setReason('');
      setNotice('تنظیم ذخیره شد و از ورودهای بعدی اعمال می‌شود.');
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiRequestError && failure.status === 409) await loadPolicy();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>امنیت سراسری</p>
        <h1>مدت نشست کارکنان</h1>
        <p className={styles.lead}>
          مدت نگه‌داشتن نشست پنل را برای اعضای مدیریتی تعیین کنید. نشست مشتریانی که عضویت مدیریتی
          ندارند تغییر نمی‌کند.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="policy-heading">
        <div>
          <h2 id="policy-heading">انقضای خودکار نشست</h2>
          <p>نشست پس از این مدت، حتی در صورت فعالیت، منقضی می‌شود. سقف مجاز ۱۲ ساعت است.</p>
        </div>

        {loading ? (
          <LoadingSkeleton label="در حال بارگذاری سیاست نشست" rows={2} />
        ) : error && !policy ? (
          <div className={styles.error} role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void loadPolicy()}>
              تلاش دوباره
            </button>
          </div>
        ) : policy ? (
          <form className={styles.form} onSubmit={savePolicy}>
            <label htmlFor="session-duration">مدت نشست</label>
            <select
              id="session-duration"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              disabled={saving}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                <option key={hour} value={hour}>
                  {new Intl.NumberFormat('fa-IR').format(hour)} ساعت
                </option>
              ))}
            </select>

            <label htmlFor="session-policy-reason">
              دلیل تغییر {policyChanged ? '(اجباری؛ حداقل ۸ نویسه)' : '(اختیاری؛ برای ممیزی)'}
            </label>
            <textarea
              id="session-policy-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required={policyChanged}
              minLength={policyChanged ? 8 : undefined}
              maxLength={500}
              rows={3}
              disabled={saving}
            />
            {policyChanged && (
              <p className={styles.note}>
                تغییر واقعی مدت نشست کارکنان نیازمند تأیید MFA تازه است.{' '}
                <a href="/fa/security/mfa">تأیید دومرحله‌ای</a>
              </p>
            )}
            <button type="submit" disabled={saving}>
              {saving ? 'در حال ذخیره...' : 'ذخیره تنظیم'}
            </button>
          </form>
        ) : null}

        {error && policy && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {policy && (
          <p className={styles.note}>
            این تغییر از ورود بعدی کارکنان اعمال می‌شود؛ نشست‌های فعال مدت قبلی خود را حفظ می‌کنند.
            نسخه‌ی تنظیم: <bdi>{policy.policyVersion}</bdi>
          </p>
        )}
      </section>
    </main>
  );
}
