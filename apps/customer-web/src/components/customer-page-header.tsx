'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FuntinoMark } from '@funtino/design-system';

import type { CustomerUser } from '../lib/customer-api';
import { CustomerIcon } from './customer-icons';

type CustomerPageHeaderProps = {
  locale: string;
  profile: CustomerUser;
};

type HeaderCopy = {
  eyebrow: string;
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
};

export function CustomerPageHeader({ locale, profile }: CustomerPageHeaderProps) {
  const pathname = usePathname();
  const copy = resolveHeaderCopy(pathname, locale, profile.firstName ?? profile.displayName);

  return (
    <header className="customer-page-header">
      <div className="customer-page-header__topline">
        <FuntinoMark compact className="customer-brand-lockup" />
        <span className="customer-page-header__presence">
          <span className="customer-page-header__presence-dot" aria-hidden="true" />
          فضای مشتری
        </span>
      </div>
      <div className="customer-page-header__copy">
        <span className="customer-page-header__eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </div>
      {copy.backHref && (
        <Link className="customer-page-header__back" href={copy.backHref}>
          <CustomerIcon name="arrow-left" size={16} />
          {copy.backLabel ?? 'بازگشت'}
        </Link>
      )}
    </header>
  );
}

function resolveHeaderCopy(
  pathname: string | null,
  locale: string,
  firstName: string | null,
): HeaderCopy {
  const sections = (pathname ?? '').split('/').filter(Boolean);
  const section = sections[1] ?? '';
  const homeName = firstName ? `سلام ${firstName}` : 'خوش اومدی';

  if (section === 'account' && sections[2] === 'profile') {
    return {
      eyebrow: 'اطلاعات شخصی',
      title: 'پروفایل من',
      description: 'هر بخش از اطلاعاتت را جداگانه ببین و فقط همان بخشی را که لازم داری ویرایش کن.',
      backHref: `/${locale}/account`,
      backLabel: 'بازگشت به حساب',
    };
  }

  switch (section) {
    case 'cards':
      return {
        eyebrow: 'کیف پول و کارت',
        title: 'کارت‌های من',
        description: 'کارت‌های تخصیص‌یافته به خانواده و وضعیت همگام‌سازی آن‌ها را ببین.',
      };
    case 'missions':
      return {
        eyebrow: 'باشگاه فانتینو',
        title: 'مأموریت‌های تو',
        description: 'هر بازی یک قدم به خاطره‌ی بهتر و جایزه‌ی تازه نزدیک‌ترت می‌کند.',
      };
    case 'family':
      return {
        eyebrow: 'با هم قشنگ‌تره',
        title: 'خانواده‌ی من',
        description: 'اعضای خانواده و فعالیت‌های مشترک را با کنترل والد مدیریت کن.',
      };
    case 'branches':
      return {
        eyebrow: 'کشف کن',
        title: 'شعبه‌های فانتینو',
        description: 'نزدیک‌ترین تجربه‌ی بازی را پیدا کن و برای یک روز متفاوت آماده شو.',
      };
    case 'account':
      return {
        eyebrow: 'تنظیمات شخصی',
        title: 'حساب من',
        description: 'کنترل تجربه‌ی فانتینو، اعلان‌ها و امنیت حساب در اختیار توست.',
      };
    default:
      return {
        eyebrow: homeName,
        title: 'امروز کجا بازی می‌کنیم؟',
        description: 'یک تجربه‌ی تازه برای تو و خانواده‌ات آماده است.',
      };
  }
}
