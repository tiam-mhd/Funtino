import * as React from 'react';
import { Button, Surface } from '@funtino/design-system';

export type BalanceScanState =
  | 'ready'
  | 'scanning'
  | 'checking'
  | 'available'
  | 'pending'
  | 'unavailable'
  | 'unsupported'
  | 'permission-denied'
  | 'no-card'
  | 'network-error'
  | 'rate-limited'
  | 'unauthorized'
  | 'error';

export function CustomerCardBalanceScanView({
  state,
  balanceRial,
  className,
  onStart,
  onCancel,
}: {
  state: BalanceScanState;
  balanceRial: number | null;
  className?: string;
  onStart: () => void;
  onCancel: () => void;
}) {
  const busy = state === 'scanning' || state === 'checking';
  const message = customerScanMessage(state);

  return (
    <Surface
      className={`${className ?? ''} nfc-balance-scan`}
      dir="rtl"
      data-state={state}
      aria-busy={busy}
    >
      <div className="nfc-balance-scan__header">
        <span className="nfc-balance-scan__mark" aria-hidden="true" />
        <div>
          <h2>بررسی موجودی کارت</h2>
          {state === 'ready' && <p>برای شروع، کارت را نزدیک محل NFC گوشی نگه دارید.</p>}
        </div>
      </div>

      {state === 'available' && balanceRial !== null ? (
        <p className="nfc-balance-scan__amount" role="status" aria-live="polite">
          {formatRial(balanceRial)} ریال
        </p>
      ) : message ? (
        <p
          className="nfc-balance-scan__message"
          role={state === 'unsupported' || state === 'permission-denied' ? 'alert' : 'status'}
          aria-live={
            state === 'unsupported' || state === 'permission-denied' ? 'assertive' : 'polite'
          }
        >
          {message}
        </p>
      ) : null}

      <div className="nfc-balance-scan__actions">
        {busy ? (
          <Button type="button" tone="ghost" onClick={onCancel}>
            انصراف
          </Button>
        ) : (
          <Button type="button" onClick={onStart}>
            {state === 'available' ? 'بررسی دوباره' : 'بررسی موجودی با کارت'}
          </Button>
        )}
      </div>
    </Surface>
  );
}

function customerScanMessage(state: BalanceScanState): string | null {
  switch (state) {
    case 'ready':
    case 'available':
      return null;
    case 'scanning':
      return 'کارت را نزدیک محل NFC گوشی نگه دارید.';
    case 'checking':
      return 'در حال بررسی موجودی…';
    case 'pending':
      return 'موجودی کارت هنوز به‌روز نشده است؛ بعداً دوباره بررسی کنید.';
    case 'unavailable':
      return 'این کارت برای حساب شما قابل بررسی نیست.';
    case 'unsupported':
      return 'امکان خواندن کارت با این دستگاه فراهم نیست.';
    case 'permission-denied':
      return 'اجازه‌ی خواندن کارت داده نشد. از تنظیمات مرورگر اجازه را فعال کنید و دوباره تلاش کنید.';
    case 'no-card':
      return 'کارت خوانده نشد؛ کارت را نزدیک نگه دارید و دوباره تلاش کنید.';
    case 'network-error':
      return 'اتصال برقرار نشد؛ دوباره تلاش کنید.';
    case 'rate-limited':
      return 'درخواست‌های بررسی موجودی زیاد شده است؛ کمی بعد دوباره تلاش کنید.';
    case 'unauthorized':
      return 'دسترسی به این بخش در دسترس نیست.';
    case 'error':
      return 'بررسی موجودی انجام نشد؛ دوباره تلاش کنید.';
  }
}

function formatRial(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}
