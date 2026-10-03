'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';

type MfaStatus = {
  enabled: boolean;
  enrollmentPending: boolean;
  recoveryCodesRemaining: number;
};
type EnrollmentStart = { secret: string; otpauthUri: string; expiresAt: string };
type MfaProof = { method: 'totp' | 'recovery'; code: string };
type StepUpResponse = { validUntil: string };
type RecoveryResponse = { recoveryCodes: string[]; validUntil: string };
type LoginPhase = 'phone' | 'otp' | 'ready' | 'forbidden';

function formatIsoTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fa-IR');
}

export function MfaManagement() {
  const [phase, setPhase] = useState<LoginPhase>('phone');
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [visibleCodes, setVisibleCodes] = useState<string[] | null>(null);
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [proofMethod, setProofMethod] = useState<MfaProof['method']>('totp');
  const [proofCode, setProofCode] = useState('');
  const [disableConfirmation, setDisableConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('در حال بررسی نشست امن شما…');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const current = await apiRequest<MfaStatus>('/api/v1/operations/mfa/status');
      setStatus(current);
      setPhase('ready');
      setMessage('وضعیت امنیت حساب به‌روز است.');
      setError('');
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setStatus(null);
        setPhase('phone');
        setMessage('برای ادامه، با شماره‌ی ثبت‌شده‌ی حساب کارکنان وارد شوید.');
        setError('');
      } else if (cause instanceof ApiRequestError && cause.status === 403) {
        setPhase('forbidden');
        setError('این حساب عضویت فعال کارکنان ندارد؛ تنظیم MFA پنل مدیریتی برای آن مجاز نیست.');
      } else {
        setPhase('phone');
        setError(cause instanceof Error ? cause.message : 'وضعیت امنیت قابل دریافت نیست.');
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'عملیات انجام نشد.');
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await apiRequest<{
        challengeId: string;
        deliveryStatus: 'confirmed' | 'unknown';
        devCode?: string;
      }>('/api/v1/auth/otp/request', { method: 'POST', body: { phone } });
      setChallengeId(result.challengeId);
      setDevCode(result.devCode ?? null);
      setPhase('otp');
      setMessage(
        result.deliveryStatus === 'unknown'
          ? 'ارسال پیامک تأیید نشده است؛ اگر پیامک رسید، کد را وارد کنید.'
          : 'کد ورود برای شماره‌ی ثبت‌شده ارسال شد.',
      );
    });
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await apiRequest('/api/v1/auth/otp/verify', {
        method: 'POST',
        body: { challengeId, phone, code: otp },
      });
      setOtp('');
      setDevCode(null);
      await refresh();
    });
  }

  async function startEnrollment() {
    await run(async () => {
      const started = await apiRequest<EnrollmentStart>('/api/v1/operations/mfa/enrollment/start', {
        method: 'POST',
      });
      setEnrollment(started);
      setMessage('کلید را در برنامه‌ی رمزساز ثبت کنید و کد ۶ رقمی آن را برای فعال‌سازی وارد کنید.');
    });
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await apiRequest<RecoveryResponse>(
        '/api/v1/operations/mfa/enrollment/confirm',
        {
          method: 'POST',
          body: { code: totpCode },
        },
      );
      setVisibleCodes(result.recoveryCodes);
      setVerifiedUntil(result.validUntil);
      setTotpCode('');
      setEnrollment(null);
      setMessage('تأیید دومرحله‌ای فعال شد؛ کدهای بازیابی را اکنون ذخیره کنید.');
      await refresh();
    });
  }

  function currentProof(): MfaProof {
    return { method: proofMethod, code: proofCode.trim() };
  }

  async function verifyStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await apiRequest<StepUpResponse>('/api/v1/operations/mfa/step-up/verify', {
        method: 'POST',
        body: currentProof(),
      });
      setVerifiedUntil(result.validUntil);
      setProofCode('');
      setMessage('تأیید مجدد این نشست تا پنج دقیقه معتبر است.');
    });
  }

  async function regenerateCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await apiRequest<RecoveryResponse>(
        '/api/v1/operations/mfa/recovery-codes/regenerate',
        { method: 'POST', body: currentProof() },
      );
      setVisibleCodes(result.recoveryCodes);
      setVerifiedUntil(result.validUntil);
      setProofCode('');
      setMessage(
        'کدهای قبلی باطل و ۱۰ کد تازه صادر شدند؛ این فهرست فقط همین بار نمایش داده می‌شود.',
      );
      await refresh();
    });
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disableConfirmation.trim() !== 'خاموش') {
      setError('برای غیرفعال‌سازی، عبارت «خاموش» را وارد کنید.');
      return;
    }
    await run(async () => {
      await apiRequest('/api/v1/operations/mfa/disable', {
        method: 'POST',
        body: currentProof(),
      });
      setVisibleCodes(null);
      setVerifiedUntil(null);
      setProofCode('');
      setDisableConfirmation('');
      setMessage('تأیید دومرحله‌ای غیرفعال شد و اثبات‌های نشست قبلی باطل شدند.');
      await refresh();
    });
  }

  async function copyCodes() {
    if (!visibleCodes) return;
    try {
      await navigator.clipboard.writeText(visibleCodes.join('\n'));
      setMessage('کدهای بازیابی در کلیپ‌بورد کپی شدند؛ آن‌ها را در محل امن نگه دارید.');
    } catch {
      setError('کپی خودکار در دسترس نیست؛ کدها را دستی در محل امن ذخیره کنید.');
    }
  }

  return (
    <main className="mfa-page" dir="rtl">
      <header className="mfa-header">
        <a href="/" className="mfa-brand" aria-label="فانتینو، صفحه‌ی اصلی">
          <span className="mfa-brand__mark" aria-hidden="true">
            ف
          </span>
          <span>
            فانتینو <small>کنترل سامانه</small>
          </span>
        </a>
        <span className="mfa-security-label">
          <span aria-hidden="true">●</span> تنظیمات امنیت حساب
        </span>
      </header>

      <section className="mfa-shell" aria-labelledby="mfa-title">
        <div className="mfa-heading">
          <span className="mfa-eyebrow">هویت مدیریتی · S0</span>
          <h1 id="mfa-title">تأیید دومرحله‌ای</h1>
          <p>
            ورود پیامکی به‌تنهایی برای عملیات حساس کافی نیست. یک برنامه‌ی رمزساز را به حساب کارکنان
            متصل کنید.
          </p>
        </div>

        {message && (
          <p className="mfa-notice" role="status" aria-live="polite">
            {message}
          </p>
        )}
        {error && (
          <p className="mfa-error" role="alert">
            {error}
          </p>
        )}

        {phase === 'phone' && (
          <form className="mfa-card mfa-form" onSubmit={requestOtp}>
            <h2>ورود به حساب کارکنان</h2>
            <label htmlFor="mfa-phone">شماره‌ی موبایل ثبت‌شده</label>
            <input
              id="mfa-phone"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="۰۹۱۲۱۲۳۴۵۶۷"
              required
              minLength={8}
              maxLength={20}
              dir="ltr"
            />
            <button className="mfa-button mfa-button--primary" disabled={busy}>
              {busy ? 'در حال ارسال…' : 'ارسال کد ورود'}
            </button>
          </form>
        )}

        {phase === 'otp' && (
          <form className="mfa-card mfa-form" onSubmit={verifyOtp}>
            <h2>کد ورود</h2>
            <p>کد یک‌بارمصرف پیامک‌شده را وارد کنید.</p>
            <label htmlFor="mfa-login-code">کد ۶ رقمی</label>
            <input
              id="mfa-login-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              dir="ltr"
            />
            {devCode && (
              <p className="mfa-dev-code">
                کد محیط توسعه: <bdi>{devCode}</bdi>
              </p>
            )}
            <button className="mfa-button mfa-button--primary" disabled={busy || otp.length !== 6}>
              {busy ? 'در حال بررسی…' : 'ورود امن'}
            </button>
            <button
              className="mfa-button mfa-button--quiet"
              type="button"
              onClick={() => setPhase('phone')}
            >
              تغییر شماره
            </button>
          </form>
        )}

        {phase === 'forbidden' && (
          <section className="mfa-card mfa-empty" aria-live="polite">
            <span className="mfa-status-icon" aria-hidden="true">
              !
            </span>
            <h2>حساب کارکنان فعال نیست</h2>
            <p>{error}</p>
            <button className="mfa-button mfa-button--quiet" onClick={() => setPhase('phone')}>
              ورود با حساب دیگر
            </button>
          </section>
        )}

        {phase === 'ready' && status && (
          <div className="mfa-content">
            <section className={`mfa-status-card ${status.enabled ? 'is-enabled' : 'is-disabled'}`}>
              <span className="mfa-status-icon" aria-hidden="true">
                {status.enabled ? '✓' : '!'}
              </span>
              <div>
                <h2>
                  {status.enabled
                    ? 'حساب با تأیید دومرحله‌ای محافظت می‌شود'
                    : 'تأیید دومرحله‌ای فعال نیست'}
                </h2>
                <p>
                  {status.enabled
                    ? `${status.recoveryCodesRemaining} کد بازیابیِ استفاده‌نشده باقی مانده است.`
                    : 'فعال‌سازی برای انجام عملیات حساس مدیریتی ضروری است.'}
                </p>
              </div>
              {status.enabled && <span className="mfa-status-pill">فعال</span>}
            </section>

            {!status.enabled && (
              <section className="mfa-card">
                <h2>۱. اتصال برنامه‌ی رمزساز</h2>
                <p>
                  از برنامه‌ای سازگار با TOTP استفاده کنید. secret فقط تا ۱۰ دقیقه برای تکمیل این
                  مرحله معتبر است.
                </p>
                {!enrollment ? (
                  <button
                    className="mfa-button mfa-button--primary"
                    onClick={startEnrollment}
                    disabled={busy}
                  >
                    {busy
                      ? 'در حال آماده‌سازی…'
                      : status.enrollmentPending
                        ? 'ادامه‌ی تنظیم'
                        : 'شروع تنظیم'}
                  </button>
                ) : (
                  <div className="mfa-enrollment">
                    <a className="mfa-button mfa-button--secondary" href={enrollment.otpauthUri}>
                      بازکردن برنامه‌ی رمزساز
                    </a>
                    <div className="mfa-secret-box">
                      <span>کلید دستی برای واردکردن در برنامه</span>
                      <code dir="ltr">{enrollment.secret}</code>
                    </div>
                    <form className="mfa-form" onSubmit={confirmEnrollment}>
                      <label htmlFor="mfa-confirm-code">کد فعلی برنامه‌ی رمزساز</label>
                      <input
                        id="mfa-confirm-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        value={totpCode}
                        onChange={(event) =>
                          setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                        required
                        dir="ltr"
                      />
                      <button
                        className="mfa-button mfa-button--primary"
                        disabled={busy || totpCode.length !== 6}
                      >
                        تأیید و فعال‌سازی
                      </button>
                    </form>
                    <p className="mfa-warning">
                      این secret را با هیچ‌کس به‌اشتراک نگذارید. پشتیبانی فانتینو آن را از شما
                      درخواست نمی‌کند.
                    </p>
                  </div>
                )}
              </section>
            )}

            {status.enabled && (
              <>
                <section className="mfa-card">
                  <h2>تأیید مجدد این نشست</h2>
                  <p>
                    کد معتبر TOTP یا یکی از کدهای بازیابی را وارد کنید. اعتبار تأیید حداکثر پنج
                    دقیقه است.
                  </p>
                  <form className="mfa-form" onSubmit={verifyStepUp}>
                    <ProofFields
                      idPrefix="stepup"
                      method={proofMethod}
                      setMethod={setProofMethod}
                      code={proofCode}
                      setCode={setProofCode}
                    />
                    <button
                      className="mfa-button mfa-button--primary"
                      disabled={busy || proofCode.trim().length < 6}
                    >
                      تأیید هویت
                    </button>
                  </form>
                  {verifiedUntil && (
                    <p className="mfa-expiry">معتبر تا: {formatIsoTime(verifiedUntil)}</p>
                  )}
                </section>

                <section className="mfa-card">
                  <h2>کدهای بازیابی</h2>
                  <p>
                    در صورت نداشتن دستگاه رمزساز، هر کد فقط یک‌بار قابل استفاده است. بازتولید، تمام
                    کدهای قبلی را باطل می‌کند.
                  </p>
                  <form className="mfa-form" onSubmit={regenerateCodes}>
                    <ProofFields
                      idPrefix="recovery"
                      method={proofMethod}
                      setMethod={setProofMethod}
                      code={proofCode}
                      setCode={setProofCode}
                    />
                    <button
                      className="mfa-button mfa-button--secondary"
                      disabled={busy || proofCode.trim().length < 6}
                    >
                      صدور ۱۰ کد تازه
                    </button>
                  </form>
                </section>

                <section className="mfa-card mfa-danger-zone">
                  <h2>غیرفعال‌سازی تأیید دومرحله‌ای</h2>
                  <p>
                    این کار اثبات‌های MFA نشست‌ها را باطل می‌کند و دسترسی به عملیات نیازمند step-up
                    را می‌بندد.
                  </p>
                  <form className="mfa-form" onSubmit={disableMfa}>
                    <ProofFields
                      idPrefix="disable"
                      method={proofMethod}
                      setMethod={setProofMethod}
                      code={proofCode}
                      setCode={setProofCode}
                    />
                    <label htmlFor="mfa-disable-confirm">برای تأیید بنویسید: خاموش</label>
                    <input
                      id="mfa-disable-confirm"
                      value={disableConfirmation}
                      onChange={(event) => setDisableConfirmation(event.target.value)}
                      autoComplete="off"
                    />
                    <button
                      className="mfa-button mfa-button--danger"
                      disabled={busy || proofCode.trim().length < 6}
                    >
                      غیرفعال‌سازی
                    </button>
                  </form>
                </section>
              </>
            )}

            <button
              className="mfa-button mfa-button--quiet mfa-refresh"
              onClick={() => void refresh()}
              disabled={busy}
            >
              تازه‌سازی وضعیت
            </button>
          </div>
        )}

        {visibleCodes && (
          <section className="mfa-code-dialog" aria-labelledby="recovery-title">
            <div className="mfa-code-dialog__header">
              <div>
                <span className="mfa-eyebrow">فقط یک‌بار نمایش داده می‌شوند</span>
                <h2 id="recovery-title">کدهای بازیابی را ذخیره کنید</h2>
              </div>
              <button
                className="mfa-close"
                onClick={() => setVisibleCodes(null)}
                aria-label="بستن فهرست کدها"
              >
                ×
              </button>
            </div>
            <p>
              این کدها در سرور به‌صورت متن قابل‌بازیابی نگه‌داری نمی‌شوند و پس از بستن این صفحه
              دوباره نمایش داده نخواهند شد.
            </p>
            <ol className="mfa-code-list" dir="ltr">
              {visibleCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ol>
            <button className="mfa-button mfa-button--secondary" onClick={copyCodes}>
              کپی کدها
            </button>
            <button
              className="mfa-button mfa-button--primary"
              onClick={() => setVisibleCodes(null)}
            >
              کدها را ذخیره کردم
            </button>
          </section>
        )}
      </section>
    </main>
  );
}

function ProofFields(props: {
  idPrefix: string;
  method: MfaProof['method'];
  setMethod: (value: MfaProof['method']) => void;
  code: string;
  setCode: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={`${props.idPrefix}-method`}>روش تأیید</label>
      <select
        id={`${props.idPrefix}-method`}
        value={props.method}
        onChange={(event) => {
          props.setMethod(event.target.value as MfaProof['method']);
          props.setCode('');
        }}
      >
        <option value="totp">برنامه‌ی رمزساز (۶ رقم)</option>
        <option value="recovery">کد بازیابی</option>
      </select>
      <label htmlFor={`${props.idPrefix}-code`}>
        {props.method === 'totp' ? 'کد ۶ رقمی' : 'کد بازیابی'}
      </label>
      <input
        id={`${props.idPrefix}-code`}
        inputMode={props.method === 'totp' ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        value={props.code}
        onChange={(event) =>
          props.setCode(
            props.method === 'totp'
              ? event.target.value.replace(/\D/g, '').slice(0, 6)
              : event.target.value.toUpperCase().slice(0, 35),
          )
        }
        required
        dir="ltr"
      />
    </>
  );
}
