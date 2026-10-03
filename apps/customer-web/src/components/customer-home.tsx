import Link from 'next/link';

import {
  Badge,
  IconBadge,
  LinkButton,
  ProgressBar,
  SectionHeading,
  Surface,
} from '@funtino/design-system';

import { customerDashboard } from '../lib/demo-data';
import type { Locale } from '../lib/locale';
import { CustomerIcon } from './customer-icons';

export function CustomerHome({ locale }: { locale: Locale }) {
  const homePath = '/' + locale;

  return (
    <main className="customer-page customer-home-page">
      <section className="customer-hero" aria-labelledby="customer-hero-title">
        <div className="customer-hero__glow customer-hero__glow--one" />
        <div className="customer-hero__glow customer-hero__glow--two" />
        <div className="customer-hero__copy">
          <span className="customer-hero__eyebrow">پیشنهاد امروز</span>
          <h2 id="customer-hero-title">ماجراجویی‌ات را شروع کن!</h2>
          <p>در {customerDashboard.branch.name} منتظر یک روز پر از بازی و خاطره‌ایم.</p>
          <LinkButton
            href={'/' + locale + '/branches'}
            tone="ghost"
            className="customer-hero__button"
          >
            کشف شعبه‌ها <CustomerIcon name="arrow-left" size={16} />
          </LinkButton>
        </div>
        <div className="customer-hero__illustration" aria-hidden="true">
          <span className="customer-hero__orbit customer-hero__orbit--one" />
          <span className="customer-hero__orbit customer-hero__orbit--two" />
          <span className="customer-hero__visual-core">
            <CustomerIcon name="sparkles" size={42} />
          </span>
          <span className="customer-hero__float customer-hero__float--ticket">
            <CustomerIcon name="ticket" size={20} />
          </span>
          <span className="customer-hero__float customer-hero__float--gift">
            <CustomerIcon name="gift" size={19} />
          </span>
          <span className="customer-hero__float customer-hero__float--target">
            <CustomerIcon name="target" size={19} />
          </span>
        </div>
      </section>

      <section className="customer-branch-card" aria-labelledby="active-branch-title">
        <div className="customer-branch-card__icon" aria-hidden="true">
          <CustomerIcon name="location" size={21} />
        </div>
        <div className="customer-branch-card__copy">
          <span className="customer-card-label">شعبه‌ی فعال تو</span>
          <h2 id="active-branch-title">{customerDashboard.branch.name}</h2>
          <p>{customerDashboard.branch.location}</p>
        </div>
        <Badge tone="success">{customerDashboard.branch.status}</Badge>
      </section>

      <section className="customer-metrics" aria-label="خلاصه‌ی حساب">
        <Surface className="customer-metric-card customer-metric-card--wallet">
          <div className="customer-metric-card__topline">
            <IconBadge icon={<CustomerIcon name="card" size={19} />} label="کارت" tone="teal" />
            <Badge tone="info">همگام</Badge>
          </div>
          <span className="customer-card-label">اعتبار کارت</span>
          <strong>{customerDashboard.wallet.balance}</strong>
          <span className="customer-metric-card__unit">تومان</span>
          <p>{customerDashboard.wallet.lastSync} به‌روزرسانی شده</p>
        </Surface>
        <Surface className="customer-metric-card customer-metric-card--points">
          <div className="customer-metric-card__topline">
            <IconBadge
              icon={<CustomerIcon name="trophy" size={19} />}
              label="امتیاز"
              tone="orange"
            />
            <span className="customer-metric-card__sparkle" aria-hidden="true">
              <CustomerIcon name="sparkles" size={20} />
            </span>
          </div>
          <span className="customer-card-label">امتیاز فانتینو</span>
          <strong>{customerDashboard.points}</strong>
          <span className="customer-metric-card__unit">امتیاز</span>
          <p>رتبه‌ی این ماه: ۲۴</p>
        </Surface>
      </section>

      <section aria-labelledby="quick-actions-title">
        <SectionHeading eyebrow="دسترسی سریع" title="برای شروع آماده‌ای؟" />
        <div className="customer-quick-actions" id="quick-actions-title">
          <Link href={homePath + '/cards'} className="customer-quick-action">
            <IconBadge
              icon={<CustomerIcon name="card" size={18} />}
              label="کارت‌های من"
              tone="teal"
            />
            <span className="customer-quick-action__copy">
              <strong>کارت‌های من</strong>
              <small>اعتبار و گردش</small>
            </span>
            <CustomerIcon name="chevron-left" size={17} className="customer-quick-action__arrow" />
          </Link>
          <Link href={homePath + '/missions'} className="customer-quick-action">
            <IconBadge
              icon={<CustomerIcon name="target" size={18} />}
              label="مأموریت‌ها"
              tone="purple"
            />
            <span className="customer-quick-action__copy">
              <strong>مأموریت‌ها</strong>
              <small>۳ مأموریت فعال</small>
            </span>
            <CustomerIcon name="chevron-left" size={17} className="customer-quick-action__arrow" />
          </Link>
          <Link href={homePath + '/family'} className="customer-quick-action">
            <IconBadge
              icon={<CustomerIcon name="family" size={18} />}
              label="خانواده"
              tone="orange"
            />
            <span className="customer-quick-action__copy">
              <strong>خانواده</strong>
              <small>۳ عضو فعال</small>
            </span>
            <CustomerIcon name="chevron-left" size={17} className="customer-quick-action__arrow" />
          </Link>
        </div>
      </section>

      <section
        className="customer-home-section customer-home-section--missions"
        aria-labelledby="missions-title"
      >
        <SectionHeading
          eyebrow="بازی کن، کشف کن، جایزه بگیر"
          title="مأموریت‌های تو"
          actionHref={homePath + '/missions'}
          actionLabel="همه‌ی مأموریت‌ها"
        />
        <div className="customer-mission-list">
          {customerDashboard.missions.map((mission) => (
            <Surface
              className={'customer-mission-card customer-mission-card--' + mission.tone}
              key={mission.id}
            >
              <div className="customer-mission-card__top">
                <IconBadge
                  icon={<CustomerIcon name={mission.icon} size={19} />}
                  label={mission.title}
                  tone={mission.tone}
                />
                <Badge tone={mission.progress === 100 ? 'success' : 'warning'}>
                  {mission.progress === 100 ? 'تکمیل شد' : 'در حال انجام'}
                </Badge>
              </div>
              <div className="customer-mission-card__content">
                <h3>{mission.title}</h3>
                <p>{mission.description}</p>
              </div>
              <div className="customer-mission-card__progress">
                <div>
                  <span>{mission.meta}</span>
                  <strong>{mission.reward}</strong>
                </div>
                <ProgressBar value={mission.progress} label={'پیشرفت ' + mission.title} />
              </div>
            </Surface>
          ))}
        </div>
      </section>

      <section
        className="customer-home-section customer-home-section--activity"
        aria-labelledby="activity-title"
      >
        <SectionHeading
          eyebrow="آخرین اتفاق‌ها"
          title="فعالیت اخیر"
          actionLabel="همه"
          actionHref={homePath + '/account'}
        />
        <Surface className="customer-activity-list">
          {customerDashboard.activities.map((activity) => (
            <div className="customer-activity-item" key={activity.id}>
              <span className="customer-activity-item__icon" aria-hidden="true">
                <CustomerIcon name={activity.icon} size={17} />
              </span>
              <div>
                <h3>{activity.title}</h3>
                <p>{activity.detail}</p>
              </div>
              <time>{activity.time}</time>
            </div>
          ))}
        </Surface>
      </section>

      <section className="customer-demo-note" aria-label="وضعیت نسخه">
        <p>
          این خروجی، لایه‌ی نمایشی اولیه است؛ اتصال به API و داده‌ی واقعی در گام بعدی انجام می‌شود.
        </p>
      </section>
    </main>
  );
}
