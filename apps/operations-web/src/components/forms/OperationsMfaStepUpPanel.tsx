'use client';

import { useState, type FormEvent } from 'react';
import { Button, Surface } from '@funtino/design-system';
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
import { normalizeDigits } from '../../lib/auth/operations-access';
import styles from './OperationsMfaStepUpPanel.module.css';

type Stage = 'verify' | 'start-enrollment' | 'confirm-enrollment' | 'save-recovery';

type Props = {
  idPrefix: string;
  mfaStepUpUntil: number | null;
  onMfaStepUp: (validUntil: number) => void;
  onSessionExpired: () => void;
};

export function OperationsMfaStepUpPanel({
  idPrefix,
  mfaStepUpUntil,
  onMfaStepUp,
  onSessionExpired,
}: Props) {
  const [status, setStatus] = useState<OperationsMfaStatus | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [method, setMethod] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<OperationsMfaEnrollment | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [recovery, setRecovery] = useState<OperationsMfaRecoveryCodes | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function openStepUp() {
    setBusy(true);
    setError('');
    try {
      const nextStatus = await getOperationsMfaStatus();
      setStatus(nextStatus);
      setStage(nextStatus.enabled ? 'verify' : 'start-enrollment');
      setCode('');
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(false);
    }
  }

  async function beginEnrollment() {
    setBusy(true);
    setError('');
    try {
      const nextEnrollment = await startOperationsMfaEnrollment();
      setEnrollment(nextEnrollment);
      setEnrollmentCode('');
      setStage('confirm-enrollment');
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(false);
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
      setError(
        method === 'totp' ? 'کد برنامه‌ی رمزساز باید ۶ رقم باشد.' : 'قالب کد بازیابی معتبر نیست.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const proof = await verifyOperationsMfaStepUp({ method, code: normalized });
      onMfaStepUp(Date.parse(proof.validUntil));
      setCode('');
      setStage(null);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeDigits(enrollmentCode).replace(/\D/g, '');
    if (!/^\d{6}$/.test(normalized)) {
      setError('کد برنامه‌ی رمزساز باید ۶ رقم باشد.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await confirmOperationsMfaEnrollment(normalized);
      setRecovery(result);
      setRecoverySaved(false);
      setEnrollment(null);
      setEnrollmentCode('');
      setStatus({
        enabled: true,
        enrollmentPending: false,
        recoveryCodesRemaining: result.recoveryCodes.length,
      });
      setStage('save-recovery');
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusy(false);
    }
  }

  function finishEnrollment() {
    if (!recovery || !recoverySaved || busy) return;
    onMfaStepUp(Date.parse(recovery.validUntil));
    setRecovery(null);
    setStage(null);
  }

  function handleFailure(failure: unknown) {
    if (failure instanceof ApiRequestError && failure.status === 401) {
      onSessionExpired();
      return;
    }
    if (failure instanceof ApiRequestError && failure.status === 403) {
      setError('اجازه‌ی تأیید MFA برای این نشست وجود ندارد.');
      return;
    }
    setError(
      failure instanceof Error ? failure.message : 'عملیات MFA انجام نشد؛ دوباره تلاش کنید.',
    );
  }

  return (
    <Surface className={styles.panel} aria-labelledby={`${idPrefix}-mfa-title`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`${idPrefix}-mfa-title`}>تأیید MFA برای عملیات حساس</h3>
          <p>
            مجوز و محدوده در سرور دوباره بررسی می‌شوند؛ این تأیید فقط برای مدت کوتاهی معتبر است.
          </p>
        </div>
        {!stage && !(mfaStepUpUntil && mfaStepUpUntil > Date.now()) && (
          <Button type="button" tone="secondary" disabled={busy} onClick={() => void openStepUp()}>
            {busy ? 'در حال بررسی…' : 'احراز MFA در این نشست'}
          </Button>
        )}
      </div>
      {!stage && mfaStepUpUntil && mfaStepUpUntil > Date.now() && (
        <p className={styles.helper} role="status">
          MFA این نشست تأیید شده است؛ اگر عملیات هنوز در دسترس نیست، نقش شما مجوز مدیریت موجودی
          ندارد.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {stage === 'verify' && (
        <form className={styles.form} onSubmit={(event) => void verifyStepUp(event)}>
          <label className={styles.field} htmlFor={`${idPrefix}-mfa-method`}>
            روش تأیید
            <select
              id={`${idPrefix}-mfa-method`}
              disabled={busy}
              value={method}
              onChange={(event) => setMethod(event.currentTarget.value as 'totp' | 'recovery')}
            >
              <option value="totp">کد برنامه‌ی رمزساز</option>
              <option value="recovery">کد بازیابی یک‌بارمصرف</option>
            </select>
          </label>
          <label className={styles.field} htmlFor={`${idPrefix}-mfa-code`}>
            {method === 'totp' ? 'کد ۶ رقمی' : 'کد بازیابی'}
            <input
              id={`${idPrefix}-mfa-code`}
              autoComplete="one-time-code"
              dir="ltr"
              inputMode={method === 'totp' ? 'numeric' : 'text'}
              maxLength={method === 'totp' ? 6 : 35}
              required
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? 'در حال تأیید…' : 'تأیید MFA'}
          </Button>
        </form>
      )}
      {stage === 'start-enrollment' && (
        <div className={styles.form}>
          <p className={styles.helper}>
            برای عملیات حساس، برنامه‌ی رمزساز را راه‌اندازی کنید؛ پیامک جایگزین MFA نیست.
          </p>
          <Button type="button" disabled={busy} onClick={() => void beginEnrollment()}>
            {busy
              ? 'در حال آماده‌سازی…'
              : status?.enrollmentPending
                ? 'ادامه‌ی راه‌اندازی MFA'
                : 'راه‌اندازی MFA'}
          </Button>
        </div>
      )}
      {stage === 'confirm-enrollment' && enrollment && (
        <form className={styles.form} onSubmit={(event) => void confirmEnrollment(event)}>
          <p className={styles.helper}>
            کلید را در برنامه‌ی رمزساز وارد و کد همان برنامه را ثبت کنید. کلید فقط در این نشست نمایش
            داده می‌شود.
          </p>
          <code className={styles.secret} dir="ltr">
            {enrollment.secret}
          </code>
          <p className={styles.helper}>مهلت راه‌اندازی: {formatDate(enrollment.expiresAt)}</p>
          <label className={styles.field} htmlFor={`${idPrefix}-mfa-enrollment-code`}>
            کد برنامه‌ی رمزساز
            <input
              id={`${idPrefix}-mfa-enrollment-code`}
              autoComplete="one-time-code"
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
              required
              value={enrollmentCode}
              onChange={(event) => setEnrollmentCode(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? 'در حال فعال‌سازی…' : 'فعال‌سازی و دریافت کدهای بازیابی'}
          </Button>
        </form>
      )}
      {stage === 'save-recovery' && recovery && (
        <div className={styles.form}>
          <p className={styles.warning}>
            کدهای بازیابی فقط همین یک‌بار نمایش داده می‌شوند. آن‌ها را در محل امن ذخیره کنید.
          </p>
          <ol className={styles.recoveryCodes} dir="ltr">
            {recovery.recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>
                <code>{recoveryCode}</code>
              </li>
            ))}
          </ol>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={recoverySaved}
              onChange={(event) => setRecoverySaved(event.currentTarget.checked)}
            />
            کدها را در محل امن ذخیره کردم
          </label>
          <Button type="button" disabled={!recoverySaved || busy} onClick={finishEnrollment}>
            ادامه و بررسی مجوزها
          </Button>
        </div>
      )}
    </Surface>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'زمان نامعتبر';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}
