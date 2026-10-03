'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { CustomerIcon } from '../../components/customer-icons';

export default function Error({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="customer-empty-page">
      <div className="customer-empty-page__icon" aria-hidden="true">
        <CustomerIcon name="settings" size={34} />
      </div>
      <h1>یک لحظه اختلال پیش آمد</h1>
      <p>داده‌های شما حذف نشده‌اند. دوباره تلاش کن یا به خانه برگرد.</p>
      <div className="customer-empty-page__actions">
        <button className="ft-button ft-button--primary" onClick={() => reset()}>
          تلاش دوباره
        </button>
        <Link className="ft-button ft-button--ghost" href="/fa">
          خانه
        </Link>
      </div>
    </main>
  );
}
