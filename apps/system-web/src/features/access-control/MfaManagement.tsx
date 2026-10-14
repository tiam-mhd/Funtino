'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { LoadingSkeleton } from '../../components/system-shell/LoadingSkeleton';

type MfaStatus = {
  enabled: boolean;
  enrollmentPending: boolean;
  recoveryCodesRemaining: number;
};
type EnrollmentStart = { secret: string; otpauthUri: string; expiresAt: string };
type MfaProof = { method: 'totp' | 'recovery'; code: string };
type StepUpResponse = { validUntil: string };
type RecoveryResponse = { recoveryCodes: string[]; validUntil: string };
type LoginPhase = 'loading' | 'ready' | 'forbidden';

function formatIsoTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fa-IR');
}

export function MfaManagement() {
  const recoveryDialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<LoginPhase>('loading');
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [visibleCodes, setVisibleCodes] = useState<string[] | null>(null);
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
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
        setPhase('forbidden');
        setMessage('نشست مدیریت پایان یافته است.');
        setError('برای ادامه، دوباره وارد نشست مدیریت شوید.');
      } else if (cause instanceof ApiRequestError && cause.status === 403) {
        setPhase('forbidden');
        setError('نشست مدیریت معتبر نیست یا مجوز تنظیم امنیت این حساب فعال نیست.');
      } else {
        setPhase('forbidden');
        setError(cause instanceof Error ? cause.message : 'وضعیت امنیت قابل دریافت نیست.');
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!visibleCodes) return;
    const dialog = recoveryDialogRef.current;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const shell = dialog?.closest('.mfa-shell');
    const localBackground = shell
      ? Array.from(shell.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && !element.classList.contains('mfa-code-backdrop'),
        )
      : [];
    const app = document.querySelector('.system-console');
    const sidebar = app?.querySelector(':scope > aside');
    const topbar = app?.querySelector(':scope > div > header');
    const globalBackground = [sidebar, topbar].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const inertTargets = [...localBackground, ...globalBackground];
    const wasInert = inertTargets.map((element) => element.inert);
    inertTargets.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = 'hidden';
    dialog?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setVisibleCodes(null);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      inertTargets.forEach((element, index) => {
        element.inert = wasInert[index];
      });
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      else document.getElementById('mfa-title')?.focus();
    };
  }, [visibleCodes]);

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
      setMessage('تأیید ثبت شد؛ اعتبار آن طبق policy زنده‌ی IAM تعیین می‌شود.');
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
      <section className="mfa-shell" aria-labelledby="mfa-title">
        <div className="mfa-heading">
          <span className="mfa-eyebrow">هویت مدیریتی · S0</span>
          <h1 id="mfa-title" tabIndex={-1}>
            تأیید دومرحله‌ای
          </h1>
          <p>
            ثبت عامل MFA برای ورود عادی لازم نیست. فرمان‌های پرریسک طبق مجوز و سیاست زنده‌ی سرور
            درخواست step-up می‌کنند.
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
        {phase === 'loading' && <LoadingSkeleton label="در حال دریافت وضعیت امنیت حساب" rows={2} />}
        {phase === 'forbidden' && (
          <button
            className="mfa-button mfa-button--primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            تلاش دوباره برای بررسی نشست
          </button>
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
                    ? `${new Intl.NumberFormat('fa-IR').format(status.recoveryCodesRemaining)} کد بازیابیِ استفاده‌نشده باقی مانده است.`
                    : 'برای ورود معمولی لازم نیست؛ فرمان‌های پرریسک بدون عامل معتبر step-up نمی‌گیرند.'}
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
          <div className="mfa-code-backdrop">
            <section
              aria-labelledby="recovery-title"
              aria-modal="true"
              className="mfa-code-dialog"
              ref={recoveryDialogRef}
              role="dialog"
              tabIndex={-1}
            >
              <div className="mfa-code-dialog__header">
                <div>
                  <span className="mfa-eyebrow">فقط یک‌بار نمایش داده می‌شوند</span>
                  <h2 id="recovery-title">کدهای بازیابی را ذخیره کنید</h2>
                </div>
                <button
                  className="mfa-close"
                  onClick={() => setVisibleCodes(null)}
                  aria-label="بستن فهرست کدها"
                  type="button"
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
              <button
                className="mfa-button mfa-button--secondary"
                onClick={copyCodes}
                type="button"
              >
                کپی کدها
              </button>
              <button
                className="mfa-button mfa-button--primary"
                onClick={() => setVisibleCodes(null)}
                type="button"
              >
                کدها را ذخیره کردم
              </button>
            </section>
          </div>
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
