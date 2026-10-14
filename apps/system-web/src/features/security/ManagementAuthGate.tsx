'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import styles from './ManagementAuthGate.module.css';

type Phase = 'checking' | 'phone' | 'otp' | 'password' | 'authenticated' | 'unavailable';
type OtpChallenge = {
  challengeId: string;
  expiresAt: string;
  deliveryStatus: 'confirmed' | 'unknown';
  devCode?: string;
};

export function ManagementAuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void apiRequest('/api/v1/auth/management/me').then(
      () => {
        if (!cancelled) setPhase('authenticated');
      },
      (failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiRequestError && failure.status === 401) {
          setPhase('phone');
          return;
        }
        setError(messageFor(failure));
        setPhase('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<OtpChallenge>('/api/v1/auth/management/otp/request', {
        method: 'POST',
        body: { phone },
      });
      setChallenge(result);
      setCode('');
      setPhase('otp');
      setNotice(
        result.deliveryStatus === 'unknown'
          ? 'وضعیت تحویل پیامک تأیید نشده است. اگر کد رسید، آن را وارد کنید.'
          : 'کد ورود مدیریتی ارسال شد.',
      );
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      setError('مهلت کد پایان یافته است. دوباره کد ورود بگیرید.');
      setPhase('phone');
      setChallenge(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ requiresPassword: boolean; expiresAt: string }>(
        '/api/v1/auth/management/otp/verify',
        {
          method: 'POST',
          body: { challengeId: challenge.challengeId, phone, code },
        },
      );
      if (result.requiresPassword) {
        setPassword('');
        setPhase('password');
      } else {
        setPhase('authenticated');
      }
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  async function verifyPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/v1/auth/management/password/verify', {
        method: 'POST',
        body: { password },
      });
      setPassword('');
      setPhase('authenticated');
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/v1/auth/management/logout', { method: 'POST' });
      setPhase('phone');
      setChallenge(null);
      setCode('');
      setPassword('');
      setNotice('از نشست مدیریتی خارج شدید.');
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'authenticated') {
    return (
      <div className={styles.consoleShell}>
        <header className={styles.sessionBar} dir="rtl">
          <span>نشست مدیریت سامانه</span>
          <nav aria-label="کنترل نشست مدیریت">
            <a href="/fa/security/management-password">امنیت حساب</a>
            <button onClick={() => void logout()} disabled={busy} type="button">
              {busy ? 'در حال خروج…' : 'خروج امن'}
            </button>
          </nav>
        </header>
        {children}
      </div>
    );
  }

  return (
    <main className={styles.page} dir="rtl">
      <section className={styles.card} aria-labelledby="management-auth-title">
        <a className={styles.brand} href="/" aria-label="فانتینو، صفحه‌ی اصلی">
          <span className={styles.brandMark} aria-hidden="true">
            ف
          </span>
          <span>
            فانتینو <small>کنترل سامانه</small>
          </span>
        </a>
        <span className={styles.eyebrow}>نشست مستقل مدیریت</span>
        <h1 id="management-auth-title">{titleFor(phase)}</h1>
        <p className={styles.intro}>{introFor(phase)}</p>

        {phase === 'checking' && (
          <p className={styles.status} role="status">
            در حال بررسی نشست مدیریت…
          </p>
        )}
        {phase === 'phone' && (
          <form className={styles.form} onSubmit={(event) => void requestOtp(event)}>
            <label htmlFor="system-management-phone">شماره‌ی همراه تأییدشده</label>
            <input
              autoComplete="tel"
              dir="ltr"
              id="system-management-phone"
              inputMode="tel"
              maxLength={20}
              minLength={8}
              onChange={(event) => setPhone(event.currentTarget.value)}
              required
              type="tel"
              value={phone}
            />
            <button className={styles.primaryButton} disabled={busy} type="submit">
              {busy ? 'در حال ارسال…' : 'ارسال کد ورود مدیریت'}
            </button>
          </form>
        )}
        {phase === 'otp' && (
          <form className={styles.form} onSubmit={(event) => void verifyOtp(event)}>
            <label htmlFor="system-management-code">کد پیامکی ۶ رقمی</label>
            <input
              autoComplete="one-time-code"
              dir="ltr"
              id="system-management-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))
              }
              pattern="[0-9]{6}"
              required
              value={code}
            />
            {challenge?.devCode && (
              <p className={styles.devCode}>
                کد محیط توسعه: <bdi>{challenge.devCode}</bdi>
              </p>
            )}
            <button
              className={styles.primaryButton}
              disabled={busy || code.length !== 6}
              type="submit"
            >
              {busy ? 'در حال بررسی…' : 'تأیید کد'}
            </button>
            <button className={styles.textButton} onClick={returnToPhone} type="button">
              تغییر شماره
            </button>
          </form>
        )}
        {phase === 'password' && (
          <form className={styles.form} onSubmit={(event) => void verifyPassword(event)}>
            <label htmlFor="system-management-password">رمز مدیریت</label>
            <input
              autoComplete="current-password"
              dir="ltr"
              id="system-management-password"
              maxLength={128}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
            <button className={styles.primaryButton} disabled={busy || !password} type="submit">
              {busy ? 'در حال بررسی…' : 'تأیید و ورود'}
            </button>
            <button className={styles.textButton} onClick={returnToPhone} type="button">
              شروع دوباره‌ی ورود
            </button>
          </form>
        )}
        {phase === 'unavailable' && (
          <button
            className={styles.primaryButton}
            onClick={() => window.location.reload()}
            type="button"
          >
            تلاش دوباره
          </button>
        )}
        {notice && (
          <p className={styles.status} role="status" aria-live="polite">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.footerNote}>
          رمز مدیریت در صورت فعال‌بودن پس از OTP پرسیده می‌شود. MFA فقط برای فرمان‌های پرریسک لازم
          است.
        </p>
      </section>
    </main>
  );

  function returnToPhone() {
    setChallenge(null);
    setCode('');
    setPassword('');
    setError('');
    setNotice('');
    setPhase('phone');
  }
}

function titleFor(phase: Phase): string {
  if (phase === 'password') return 'رمز مدیریت را تأیید کنید';
  if (phase === 'otp') return 'کد ورود مدیریت را وارد کنید';
  if (phase === 'unavailable') return 'نشست مدیریت بررسی نشد';
  if (phase === 'checking') return 'در حال بررسی دسترسی';
  return 'ورود به پنل مدیریت سامانه';
}

function introFor(phase: Phase): string {
  if (phase === 'password')
    return 'کد پیامکی تأیید شد. نشست مدیریت تا تأیید این رمز ساخته نمی‌شود.';
  if (phase === 'otp')
    return 'کد به شماره‌ی واردشده ارسال شده است. این کد فقط برای ورود مدیریتی معتبر است.';
  if (phase === 'unavailable')
    return 'سرویس احراز هویت پاسخ کامل نداد؛ تا تأیید نشست، هیچ صفحه‌ی مدیریتی نمایش داده نمی‌شود.';
  if (phase === 'checking') return 'صفحات کنسول فقط با نشست دارای audience مدیریت باز می‌شوند.';
  return 'برای ورود به این بخش، کد پیامکی مدیریتی را تأیید کنید.';
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiRequestError) return failure.message;
  if (failure instanceof Error && failure.message) return failure.message;
  return 'ارتباط با سرویس احراز هویت برقرار نشد.';
}
