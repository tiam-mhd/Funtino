'use client';

import Link from 'next/link';

import { avatarSource } from '../lib/customer-api';
import { useCustomerAuth } from './customer-auth-gate';
import { CustomerIcon } from './customer-icons';

export function CustomerAccount({ locale }: { locale: string }) {
  const { profile, signOut } = useCustomerAuth();
  const profileName = profile.displayName || 'پروفایل من';
  const avatarUrl = avatarSource(profile);

  return (
    <main className="customer-page customer-account-page">
      <Link
        className="account-profile-card account-profile-card--link"
        href={`/${locale}/account/profile`}
        aria-label="مشاهده و ویرایش پروفایل"
      >
        <span className="account-profile-card__avatar">
          {avatarUrl ? (
            // The avatar endpoint is private and cookie-authenticated.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" />
          ) : (
            <CustomerIcon name="user" size={22} />
          )}
        </span>
        <span>
          <strong>پروفایل من</strong>
          <h2>{profileName}</h2>
          <p>مشاهده و ویرایش اطلاعات شخصی</p>
        </span>
        <span className="account-setting__arrow" aria-hidden="true">
          <CustomerIcon name="chevron-left" size={18} />
        </span>
      </Link>

      <section className="account-settings-list" aria-label="تنظیمات حساب">
        <div className="account-setting">
          <span className="account-setting__icon">
            <CustomerIcon name="bell" size={18} />
          </span>
          <span>
            <strong>اعلان‌ها</strong>
            <small>اعلان‌های مهم فانتینو</small>
          </span>
        </div>
        <div className="account-setting">
          <span className="account-setting__icon">
            <CustomerIcon name="shield" size={18} />
          </span>
          <span>
            <strong>امنیت و ورود</strong>
            <small dir="ltr">{profile.phoneE164}</small>
          </span>
        </div>
        <div className="account-setting">
          <span className="account-setting__icon">
            <CustomerIcon name="help" size={18} />
          </span>
          <span>
            <strong>راهنما و پشتیبانی</strong>
            <small>پاسخ سؤال‌های پرتکرار</small>
          </span>
        </div>
      </section>

      <button
        type="button"
        className="customer-secondary-button customer-signout-button"
        onClick={() => void signOut()}
      >
        خروج از حساب <CustomerIcon name="arrow-left" size={17} />
      </button>
    </main>
  );
}
