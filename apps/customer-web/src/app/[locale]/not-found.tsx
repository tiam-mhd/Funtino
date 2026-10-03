import Link from 'next/link';

import { CustomerIcon } from '../../components/customer-icons';

export default function NotFound() {
  return (
    <main className="customer-empty-page">
      <div className="customer-empty-page__icon" aria-hidden="true">
        <CustomerIcon name="map" size={34} />
      </div>
      <h1>این مسیر هنوز ساخته نشده</h1>
      <p>می‌توانی به خانه برگردی و از مسیرهای اصلی فانتینو استفاده کنی.</p>
      <Link className="ft-button ft-button--primary" href="/fa">
        بازگشت به خانه
      </Link>
    </main>
  );
}
