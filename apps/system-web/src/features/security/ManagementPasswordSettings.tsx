'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';
import styles from './ManagementPasswordSettings.module.css';

type PasswordStatus = { enabled: boolean };
type OtpChallenge = {
  challengeId: string;
  expiresAt: string;
  deliveryStatus: 'confirmed' | 'unknown';
  devCode?: string;
};
type Action = 'save' | 'disable';

export function ManagementPasswordSettings() {
  const [status, setStatus] = useState<PasswordStatus | null>(null);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [action, setAction] = useState<Action>('save');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setStatusLoading(true);
    setError('');
    try {
      setStatus(await apiRequest<PasswordStatus>('/api/v1/auth/management/password'));
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setStatusLoading(false);
    }
  }

  async function requestCode() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<OtpChallenge>(
        '/api/v1/auth/management/password/otp/request',
        {
          method: 'POST',
        },
      );
      setChallenge(result);
      setCode('');
      setNotice(
        result.deliveryStatus === 'unknown'
          ? 'وضعیت تحویل پیامک تأیید نشده است؛ اگر کد رسید، آن را وارد کنید.'
          : 'کد تأیید برای شماره‌ی حساب مدیریت ارسال شد.',
      );
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status || !challenge) {
      setError('ابتدا کد تأیید را درخواست کنید.');
      return;
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      setChallenge(null);
      setError('مهلت کد تمام شده است؛ کد تازه بگیرید.');
      return;
    }
    if (action === 'save' && (password.length < 12 || password.length > 128)) {
      setError('رمز مدیریت باید بین ۱۲ تا ۱۲۸ نویسه باشد.');
      return;
    }
    if (action === 'save' && password !== confirmation) {
      setError('تکرار رمز با رمز جدید یکسان نیست.');
      return;
    }
    if (status.enabled && !currentPassword) {
      setError('برای تغییر یا غیرفعال‌سازی، رمز فعلی را وارد کنید.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const enabled = action === 'save';
      await apiRequest('/api/v1/auth/management/password', {
        method: 'PUT',
        body: {
          enabled,
          challengeId: challenge.challengeId,
          code,
          ...(enabled ? { password } : {}),
          ...(status.enabled ? { currentPassword } : {}),
        },
      });
      setStatus({ enabled });
      setChallenge(null);
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
      setCode('');
      setAction('save');
      setNotice(
        enabled
          ? 'رمز مدیریت با موفقیت ذخیره شد.'
          : 'رمز مدیریت غیرفعال شد. ورود با OTP ادامه دارد.',
      );
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  const isReady = status !== null;

  return (
    <main className={styles.page} dir="rtl">
      <section className={styles.card} aria-labelledby="management-password-title">
        <span className={styles.eyebrow}>امنیت نشست مدیریت</span>
        <h1 id="management-password-title">رمز اختیاری مدیریت</h1>
        <p className={styles.intro}>
          ورود مدیریت با OTP انجام می‌شود. اگر رمز را فعال کنید، پس از OTP نیز پرسیده می‌شود؛ MFA
          فقط برای فرمان‌های پرریسک درخواست می‌شود.
        </p>

        {!isReady && statusLoading && (
          <LoadingSkeleton label="در حال بررسی وضعیت رمز مدیریت" rows={1} />
        )}
        {isReady && (
          <p className={status.enabled ? styles.enabled : styles.disabled} role="status">
            رمز مدیریت{' '}
            {status.enabled ? 'فعال است.' : 'فعال نیست؛ ورود با OTP به‌تنهایی ادامه می‌یابد.'}
          </p>
        )}
        {error && (
          <div className={styles.error} role="alert">
            <p>{error}</p>
            {!isReady && (
              <button disabled={statusLoading} onClick={() => void refresh()} type="button">
                {statusLoading ? 'در حال تلاش…' : 'تلاش دوباره'}
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className={styles.notice} role="status" aria-live="polite">
            {notice}
          </p>
        )}

        {isReady && (
          <>
            <div className={styles.actions} role="group" aria-label="عملیات رمز مدیریت">
              <button
                aria-pressed={action === 'save'}
                className={action === 'save' ? styles.selected : ''}
                onClick={() => setAction('save')}
                type="button"
              >
                {status.enabled ? 'تغییر رمز' : 'فعال‌سازی رمز'}
              </button>
              {status.enabled && (
                <button
                  aria-pressed={action === 'disable'}
                  className={action === 'disable' ? styles.selected : ''}
                  onClick={() => setAction('disable')}
                  type="button"
                >
                  غیرفعال‌سازی
                </button>
              )}
            </div>

            <form className={styles.form} onSubmit={(event) => void submit(event)}>
              {status.enabled && (
                <label>
                  رمز فعلی
                  <input
                    autoComplete="current-password"
                    maxLength={128}
                    onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                    required
                    type="password"
                    value={currentPassword}
                  />
                </label>
              )}
              {action === 'save' && (
                <>
                  <label>
                    رمز جدید (۱۲ تا ۱۲۸ نویسه)
                    <input
                      autoComplete={status.enabled ? 'new-password' : 'new-password'}
                      maxLength={128}
                      minLength={12}
                      onChange={(event) => setPassword(event.currentTarget.value)}
                      required
                      type="password"
                      value={password}
                    />
                  </label>
                  <label>
                    تکرار رمز جدید
                    <input
                      autoComplete="new-password"
                      maxLength={128}
                      onChange={(event) => setConfirmation(event.currentTarget.value)}
                      required
                      type="password"
                      value={confirmation}
                    />
                  </label>
                </>
              )}
              <div className={styles.codeRow}>
                <label>
                  کد پیامکی تأیید
                  <input
                    autoComplete="one-time-code"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))
                    }
                    pattern="[0-9]{6}"
                    required
                    value={code}
                  />
                </label>
                <button disabled={busy} onClick={() => void requestCode()} type="button">
                  {busy ? 'در حال ارسال…' : 'دریافت کد'}
                </button>
              </div>
              {challenge?.devCode && (
                <p className={styles.devCode}>
                  کد محیط توسعه: <bdi>{challenge.devCode}</bdi>
                </p>
              )}
              <button
                className={styles.submit}
                disabled={busy || !challenge || code.length !== 6}
                type="submit"
              >
                {busy
                  ? 'در حال ذخیره…'
                  : action === 'disable'
                    ? 'غیرفعال‌سازی رمز'
                    : 'ذخیره رمز مدیریت'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس احراز هویت برقرار نشد.';
}
