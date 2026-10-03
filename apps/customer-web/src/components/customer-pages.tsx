import {
  Badge,
  IconBadge,
  LinkButton,
  ProgressBar,
  SectionHeading,
  Surface,
} from '@funtino/design-system';

import { branches, customerDashboard } from '../lib/demo-data';
import { CustomerCardsList } from './customer-cards';
import { CustomerIcon, type CustomerIconName } from './customer-icons';

function DemoNote({ children }: { children: string }) {
  return (
    <div className="customer-inline-note" role="status">
      <CustomerIcon name="sparkles" size={17} />
      <p>{children}</p>
    </div>
  );
}

export function CardsPage() {
  return (
    <main className="customer-page">
      <CustomerCardsList />
    </main>
  );
}

export function MissionsPage() {
  return (
    <main className="customer-page">
      <div className="customer-mission-highlight">
        <div>
          <span>امتیاز فعلی تو</span>
          <strong>{customerDashboard.points}</strong>
          <small>تا نشان بعدی فقط ۲۳۵ امتیاز</small>
        </div>
        <div className="customer-mission-highlight__trophy" aria-hidden="true">
          <CustomerIcon name="trophy" size={58} />
        </div>
      </div>

      <section aria-labelledby="all-missions-title">
        <SectionHeading eyebrow="فعال و قابل انجام" title="مأموریت‌ها" />
        <div className="customer-mission-list" id="all-missions-title">
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
                <Badge tone="warning">جایزه دارد</Badge>
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
      <DemoNote>
        پیشرفت مأموریت‌ها در نسخه‌ی واقعی از رویدادهای معتبر شعبه و کارت خوانده می‌شود.
      </DemoNote>
    </main>
  );
}

export function FamilyPage() {
  return (
    <main className="customer-page">
      <Surface className="family-summary">
        <div className="family-summary__avatars" aria-hidden="true">
          {customerDashboard.family.map((member) => (
            <span className={'family-avatar family-avatar--' + member.color} key={member.id}>
              {member.initials}
            </span>
          ))}
        </div>
        <div>
          <strong>۳ عضو فعال</strong>
          <p>خانواده‌ی محمدی</p>
        </div>
        <Badge tone="success">همگام</Badge>
      </Surface>

      <section aria-labelledby="family-members-title">
        <SectionHeading eyebrow="اعضای خانواده" title="اعضا" />
        <div className="family-member-list" id="family-members-title">
          {customerDashboard.family.map((member) => (
            <Surface className="family-member" key={member.id}>
              <span className={'family-avatar family-avatar--' + member.color}>
                {member.initials}
              </span>
              <div>
                <h2>{member.name}</h2>
                <p>{member.role}</p>
              </div>
              <Badge tone={member.role === 'والد' ? 'info' : 'success'}>{member.status}</Badge>
            </Surface>
          ))}
        </div>
      </section>

      <LinkButton href="/fa" tone="secondary">
        <CustomerIcon name="plus" size={17} /> دعوت از بزرگسال دیگر
      </LinkButton>
      <DemoNote>دسترسی کودک به اطلاعات و عملیات مالی همیشه تحت کنترل سرپرست می‌ماند.</DemoNote>
    </main>
  );
}

export function BranchesPage() {
  const branchIcons: Record<(typeof branches)[number]['color'], CustomerIconName> = {
    orange: 'roller-coaster',
    teal: 'carousel',
    purple: 'ferris-wheel',
  };

  return (
    <main className="customer-page">
      <div className="branch-list">
        {branches.map((branch) => (
          <Surface className="branch-card" key={branch.id}>
            <div
              className={'branch-card__art branch-card__art--' + branch.color}
              aria-hidden="true"
            >
              <CustomerIcon name={branchIcons[branch.color]} size={52} />
            </div>
            <div className="branch-card__body">
              <div className="branch-card__title">
                <div>
                  <h2>{branch.name}</h2>
                  <p>{branch.location}</p>
                </div>
                <Badge tone={branch.status === 'باز است' ? 'success' : 'warning'}>
                  {branch.status}
                </Badge>
              </div>
              <div className="branch-card__meta">
                <span>
                  <CustomerIcon name="location" size={13} /> {branch.distance}
                </span>
                <span>
                  <CustomerIcon name="sparkles" size={13} /> {branch.attractions}
                </span>
              </div>
              <LinkButton href="/fa" tone="ghost">
                دیدن جزئیات
              </LinkButton>
            </div>
          </Surface>
        ))}
      </div>
    </main>
  );
}
